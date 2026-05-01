const express = require('express');
const puppeteer = require('puppeteer');

const app = express();

app.get('/', (req, res) => {
  res.send('Server attivo');
});

app.get('/thumbs', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.send('Missing URL');
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await new Promise(resolve => setTimeout(resolve, 8000));

    const images = await page.evaluate(() => {
      const fromImgs = Array.from(document.querySelectorAll('.fotorama__img'))
        .map(img => img.src)
        .filter(Boolean);

      let fromFotorama = [];

      try {
        if (window.jQuery) {
          const fotorama = window.jQuery('.fotorama').data('fotorama');

          if (fotorama && Array.isArray(fotorama.data)) {
            fromFotorama = fotorama.data
              .flatMap(item => [item.thumb, item.img, item.full])
              .filter(Boolean);
          }
        }
      } catch (e) {}

      return [...fromImgs, ...fromFotorama];
    });

    const unique = [...new Set(images)];

    if (unique.length === 0) {
      return res.send('No thumbnails found');
    }

    let html = `
      <html>
        <body>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
    `;

    unique.forEach(img => {
      html += `
        <a href="${img}" target="_blank" rel="noopener noreferrer">
          <img src="${img}" width="30" height="30" style="object-fit:cover;border:1px solid #ccc;" />
        </a>
      `;
    });

    html += `
          </div>
        </body>
      </html>
    `;

    res.send(html);

  } catch (err) {
    res.send('Errore: ' + err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
