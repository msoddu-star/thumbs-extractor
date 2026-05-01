const express = require('express');
const puppeteer = require('puppeteer');

const app = express();

app.get('/thumbs', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.send('Missing URL');
  }

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });

    // aspetta caricamento gallery
    await new Promise(r => setTimeout(r, 6000));

    const images = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.fotorama__img'))
        .map(img => img.src)
        .filter(Boolean);
    });

    await browser.close();

    // rimuove duplicati
    const unique = [...new Set(images)];

    let html = '';

    unique.forEach(img => {
      html += `<a href="${img}" target="_blank">
        <img src="${img}" width="30" height="30" style="margin:3px;border:1px solid #ccc;" />
      </a>`;
    });

    res.send(html);

  } catch (err) {
    res.send('Errore: ' + err.message);
  }
});

app.get('/', (req, res) => {
  res.send('Server attivo 👍');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
