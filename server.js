const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper attivo. Usa /scrape?url=...' });
});

app.get('/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Parametro url mancante' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'URL non valido' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const result = await page.evaluate(() => {
      const found = { method: null, rawPaths: [], baseUrl: null };

      // --- Metodo 1: script type="text/x-magento-init" ---
      const scripts = Array.from(document.querySelectorAll('script[type="text/x-magento-init"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          for (const selector of Object.keys(json)) {
            const node = json[selector];

            // mage/gallery/gallery contiene .data[] con .full, .img, .thumb
            if (node['mage/gallery/gallery']) {
              const items = node['mage/gallery/gallery'].data;
              if (Array.isArray(items) && items.length) {
                found.method = 'mage/gallery/gallery';
                found.rawPaths = items.map(i => i.full || i.img || i.thumb).filter(Boolean);
                return found;
              }
            }

            // Magento_Catalog provider
            if (node['Magento_Catalog/js/product/view/provider']) {
              const items = node['Magento_Catalog/js/product/view/provider'].data?.items;
              if (items) {
                found.method = 'Magento_Catalog/provider';
                found.rawPaths = Object.values(items)
                  .flatMap(item => (item.media_gallery_entries || []).map(e => e.file))
                  .filter(Boolean);
                if (found.rawPaths.length) return found;
              }
            }
          }
        } catch {}
      }

      // --- Metodo 2: data-mage-init sul gallery container ---
      const gallery = document.querySelector('[data-gallery-role="gallery-placeholder"]');
      if (gallery) {
        try {
          const init = JSON.parse(gallery.getAttribute('data-mage-init') || '{}');
          const items = init['mage/gallery/gallery']?.data || [];
          if (items.length) {
            found.method = 'data-mage-init';
            found.rawPaths = items.map(i => i.full || i.img || i.thumb).filter(Boolean);
            return found;
          }
        } catch {}
      }

      // --- Metodo 3: fallback DOM fotorama (thumbnail, meno preciso) ---
      const imgSelector = '.fotorama__stage img, .fotorama__nav__frame img';
      const els = Array.from(document.querySelectorAll(imgSelector));
      found.method = 'fallback-dom';
      found.rawPaths = els
        .map(el => el.getAttribute('data-full') || el.getAttribute('data-zoom-image') ||
                   el.getAttribute('data-large') || el.getAttribute('data-src') || el.src)
        .filter(src => src && src.startsWith('http'));
      return found;
    });

    // Se i path sono relativi (es. /media/catalog/...), costruisci l'URL assoluto
    const origin = new URL(url).origin;
    const images = result.rawPaths.map(p =>
      p.startsWith('http') ? p : `${origin}${p.startsWith('/') ? '' : '/'}${p}`
    );

    // Rimuovi cache path Magento se ancora presenti
    const cleaned = images.map(src =>
      src.replace(/\/cache\/[^/]+\//, '/')
         .replace(/\/small_image\/\d+x\d+\/[^/]+\//, '/')
         .replace(/\/thumbnail\/\d+x\d+\/[^/]+\//, '/')
    );

const unique = [...new Set(cleaned)];

// proxy automatico immagini
const proxied = unique.map(img =>
  `https://image-proxy-1-9zk6.onrender.com/image?url=${encodeURIComponent(img)}`
);

res.json({
  url,
  method: result.method,
  count: proxied.length,
  images: proxied,
  originalImages: unique
});

  } catch (err) {
    console.error(err);
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});
const https = require('https');
const http = require('http');

app.get('/image', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Parametro url mancante' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'URL non valido' });
  }

  const fetchImage = (targetUrl, redirectCount = 0) => {
    if (redirectCount > 5) return res.status(500).json({ error: 'Troppi redirect' });
    const client = targetUrl.startsWith('https') ? https : http;
    client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://store.lemanicasa.com/',
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        if (!location) return res.status(500).json({ error: 'Redirect senza location' });
        const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).href;
        return fetchImage(nextUrl, redirectCount + 1);
      }
      const contentType = response.headers['content-type'] || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      response.pipe(res);
    }).on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  };

  fetchImage(url);
});
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`)); 
