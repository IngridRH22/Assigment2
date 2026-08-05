// Express
const express = require("express");
const app = express();
app.use(express.static("public"));
// Start the web server
app.listen(5500, function() {
   console.log("Listening on port 5500...");
});

app.set("views", "views");
app.set("view engine", "pug");


// MongoDB
const mongoose = require("mongoose");
mongoose.connect("mongodb+srv://ingridrh2005_db_user:e8rDFKeaMsecu6Ou@a2.ko4lkxu.mongodb.net/?appName=A2")
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("Na " + err.message));



app.get("/", function(req, res) {
   res.render("login");
});

app.post("/login", function (req, res) {

});