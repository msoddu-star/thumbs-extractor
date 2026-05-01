const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

const jobs = {};
let latestJobId = null;

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    routes: [
      '/scrape?url=...',
      '/result/:id',
      '/latest',
      '/latest.html'
    ]
  });
});

function createJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function runScrape(jobId, url) {
  jobs[jobId].status = 'running';

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await new Promise(resolve => setTimeout(resolve, 20000));

    const images = await page.evaluate(() => {
      const results = [];

      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.dataset.src || img.getAttribute('data-src');
        if (src && src.includes('/media/catalog/product/')) {
          results.push(src);
        }
      });

      try {
        if (window.jQuery) {
          const fotorama = window.jQuery('.fotorama').data('fotorama');
          if (fotorama && Array.isArray(fotorama.data)) {
            fotorama.data.forEach(item => {
              if (item.thumb) results.push(item.thumb);
              if (item.img) results.push(item.img);
              if (item.full) results.push(item.full);
            });
          }
        }
      } catch (e) {}

      return results;
    });

    const unique = [...new Set(images)];

    jobs[jobId] = {
      id: jobId,
      status: 'done',
      url,
      count: unique.length,
      images: unique,
      finishedAt: new Date().toISOString()
    };

  } catch (err) {
    jobs[jobId] = {
      id: jobId,
      status: 'error',
      url,
      error: err.message,
      finishedAt: new Date().toISOString()
    };
  } finally {
    if (browser) await browser.close();
  }
}

app.get('/scrape', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parametro url mancante' });
  }

  const jobId = createJobId();
  latestJobId = jobId;

  jobs[jobId] = {
    id: jobId,
    status: 'queued',
    url,
    createdAt: new Date().toISOString()
  };

  runScrape(jobId, url);

  res.json({
    status: 'started',
    jobId,
    resultUrl: `/result/${jobId}`,
    latestUrl: '/latest',
    message: 'Estrazione avviata. Controlla /latest tra 30-60 secondi.'
  });
});

app.get('/result/:id', (req, res) => {
  const job = jobs[req.params.id];

  if (!job) {
    return res.status(404).json({ error: 'Job non trovato' });
  }

  res.json(job);
});

app.get('/latest', (req, res) => {
  if (!latestJobId || !jobs[latestJobId]) {
    return res.json({ status: 'empty', images: [] });
  }

  res.json(jobs[latestJobId]);
});

app.get('/latest.html', (req, res) => {
  if (!latestJobId || !jobs[latestJobId] || !jobs[latestJobId].images) {
    return res.send('Nessuna immagine disponibile');
  }

  const images = jobs[latestJobId].images;

  let html = '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

  images.forEach(img => {
    html += `<a href="${img}" target="_blank">
      <img src="${img}" width="30" height="30" style="object-fit:cover;border:1px solid #ccc;" />
    </a>`;
  });

  html += '</div>';

  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Server avviato su porta ${PORT}`);
});
