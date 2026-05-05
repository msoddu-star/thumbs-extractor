app.use(express.static('public'));

app.get('/app', function(req, res) {
    res.send('App is running!');
});

// Existing middleware and other routes below this line

app.get('/', function(req, res) {
    res.send('Main Page');
});
