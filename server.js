app.use(express.static('public'));

app.get('/app', (req, res) => {
  res.sendFile(__dirname + '/public/app.html');
});

// Existing middleware and other routes below this line

app.get('/', function(req, res) {
    res.send('Main Page');
});
