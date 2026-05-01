const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper attivo. Usa /scrape?url=...' });
});

app.get('/scrape', async (req, res) => {
  const { url, selector } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parametro url mancante' });
  }

  const imgSelector = selector || '.fotorama__nav__frame img';

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Aspetta che le thumbnail siano caricate
    await page.waitForSelector(imgSelector, { timeout: 15000 }).catch(() => {
      console.log('Selector non trovato, procedo comunque...');
    });

    // Piccola pausa extra per JS asincrono
    await new Promise(r => setTimeout(r, 2000));

    const images = await page.$$eval(imgSelector, els =>
      els
        .map(el => el.src || el.dataset.src || el.getAttribute('data-img-src'))
        .filter(src => src && src.startsWith('http'))
    );

    // Deduplicazione
    const unique = [...new Set(images)];

    res.json({
      url,
      selector: imgSelector,
      count: unique.length,
      images: unique,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Server avviato su porta ${PORT}`);
});
