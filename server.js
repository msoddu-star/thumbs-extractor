const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    endpoints: [
      '/product-data?url=...',
      '/scrape?url=...'
    ]
  });
});

app.get('/app', (req, res) => {
  res.sendFile(__dirname + '/public/app.html');
});

function cleanMagentoUrl(src) {
  if (!src) return null;

  return src
    .replace(/\/media\/catalog\/product\/cache\/[^/]+\//, '/media/catalog/product/')
    .replace(/\/cache\/[^/]+\//, '/')
    .replace(/\/small_image\/\d+x\d+\/[^/]+\//, '/')
    .replace(/\/thumbnail\/\d+x\d+\/[^/]+\//, '/');
}

function absoluteUrl(path, origin) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function scrapeProduct(url) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      const out = {
        name: null,
        brand: null,
        price_full: null,
        price_discounted: null,
        discount: null,
        availability: null,
        images: [],
        method: null
      };

      // Nome prodotto
      out.name =
        document.querySelector('h1.page-title span')?.textContent?.trim() ||
        document.querySelector('h1.page-title')?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.content?.trim() ||
        document.title?.trim() ||
        null;

      // Brand: prova varie posizioni comuni Magento
      out.brand =
        document.querySelector('[itemprop="brand"]')?.textContent?.trim() ||
        document.querySelector('.product.attribute.brand .value')?.textContent?.trim() ||
        document.querySelector('.brand .value')?.textContent?.trim() ||
        document.querySelector('.product-brand')?.textContent?.trim() ||
        null;

      // Prezzi
      const specialPrice =
        document.querySelector('.special-price .price')?.textContent?.trim() ||
        document.querySelector('[data-price-type="finalPrice"] .price')?.textContent?.trim() ||
        document.querySelector('.price-final_price .price')?.textContent?.trim() ||
        null;

      const oldPrice =
        document.querySelector('.old-price .price')?.textContent?.trim() ||
        document.querySelector('[data-price-type="oldPrice"] .price')?.textContent?.trim() ||
        null;

      out.price_discounted = specialPrice;
      out.price_full = oldPrice || specialPrice;

      // Sconto testuale se presente
      out.discount =
        document.querySelector('.discount')?.textContent?.trim() ||
        document.querySelector('.saving')?.textContent?.trim() ||
        document.querySelector('.product-label')?.textContent?.trim() ||
        null;

      // Disponibilità
      out.availability =
        document.querySelector('.stock.available span')?.textContent?.trim() ||
        document.querySelector('.stock.unavailable span')?.textContent?.trim() ||
        document.querySelector('.stock')?.textContent?.trim() ||
        null;

      // Gallery Magento principale
      const scripts = Array.from(document.querySelectorAll('script[type="text/x-magento-init"]'));

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);

          for (const selector of Object.keys(json)) {
            const node = json[selector];

            if (node['mage/gallery/gallery']?.data?.length) {
              out.method = 'mage/gallery/gallery';

              out.images = node['mage/gallery/gallery'].data.map(i => ({
                thumb: i.thumb || i.img || i.full || null,
                img: i.img || i.full || i.thumb || null,
                full: i.full || i.img || i.thumb || null,
                caption: i.caption || null
              }));

              return out;
            }
          }
        } catch (e) {}
      }

      // Gallery da data-mage-init
      const gallery = document.querySelector('[data-gallery-role="gallery-placeholder"]');

      if (gallery) {
        try {
          const init = JSON.parse(gallery.getAttribute('data-mage-init') || '{}');
          const items = init['mage/gallery/gallery']?.data || [];

          if (items.length) {
            out.method = 'data-mage-init';

            out.images = items.map(i => ({
              thumb: i.thumb || i.img || i.full || null,
              img: i.img || i.full || i.thumb || null,
              full: i.full || i.img || i.thumb || null,
              caption: i.caption || null
            }));

            return out;
          }
        } catch (e) {}
      }

      // Fallback Fotorama / DOM
      const els = Array.from(document.querySelectorAll(
        '.fotorama__stage img, .fotorama__nav__frame img, img.fotorama__img--full, .gallery-placeholder img'
      ));

      out.method = 'fallback-dom';

      out.images = els
        .map(el => {
          const src =
            el.getAttribute('data-full') ||
            el.getAttribute('data-zoom-image') ||
            el.getAttribute('data-large') ||
            el.getAttribute('data-src') ||
            el.src;

          return src ? {
            thumb: src,
            img: src,
            full: src,
            caption: el.alt || null
          } : null;
        })
        .filter(Boolean);

      return out;
    });

    const origin = new URL(url).origin;

    const cleanedImages = data.images
      .map(img => ({
        thumb: cleanMagentoUrl(absoluteUrl(img.thumb, origin)),
        img: cleanMagentoUrl(absoluteUrl(img.img, origin)),
        full: cleanMagentoUrl(absoluteUrl(img.full, origin)),
        caption: img.caption || null
      }))
      .filter(img => img.full || img.img || img.thumb);

    // deduplica per full/img/thumb
    const seen = new Set();
    const uniqueImages = [];

    for (const img of cleanedImages) {
      const key = img.full || img.img || img.thumb;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueImages.push(img);
      }
    }

    return {
      url,
      name: data.name,
      brand: data.brand,
      price_full: data.price_full,
      price_discounted: data.price_discounted,
      discount: data.discount,
      availability: data.availability,
      method: data.method,
      count: uniqueImages.length,
      images: uniqueImages
    };

  } finally {
    if (browser) await browser.close();
  }
}

app.get('/product-data', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parametro url mancante' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL non valido' });
  }

  try {
    const result = await scrapeProduct(url);
    res.json(result);
  } catch (err) {
    console.error(err);
    const status = err.message && err.message.toLowerCase().includes('timeout') ? 504 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Compatibilità col vecchio endpoint: restituisce solo array immagini full
app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parametro url mancante' });
  }

  try {
    const result = await scrapeProduct(url);

    res.json({
      url,
      method: result.method,
      count: result.count,
      images: result.images.map(i => i.full || i.img || i.thumb).filter(Boolean)
    });

  } catch (err) {
    console.error(err);
    const status = err.message && err.message.toLowerCase().includes('timeout') ? 504 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server avviato su porta ${PORT}`);
});
