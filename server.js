const express = require("express");
const app = express();

// Serve static files from the public dir
app.use(express.static("public"));

// Start the web server
app.listen(5500, function() {
   console.log("Listening on port 5500...");
});

app.set("views", "views");
app.set("view engine", "pug");

app.get("/", function(req, res) {
   res.render("login");
});

app.post("/login", function (req, res) {

});