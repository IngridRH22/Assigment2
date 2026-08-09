// Express
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const app = express();
const path = require("path");

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

//Pa sesion
const MongoStore = require("connect-mongo").default;

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 60 * 60 * 24
  })
}));


//Pa vecel
app.use(express.static(path.join(__dirname, "./styles")));
app.set("views", path.join(__dirname, "./views"));
app.set("view engine", "pug");



// MongoDB
const mongoose = require("mongoose");
let conectado = false;
async function connectDB() {
  if (conectado) return;
  // Conexion a db
  await mongoose.connect(process.env.MONGODB_URI)
    .then(() => { conectado = true; console.log("MongoDB Connected"); })
    .catch((err) => console.log("Na " + err.message));
}

//Entreteiment data
const urldefault = "https://api.themoviedb.org/3";
const tmdbOptions = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    Authorization: 'Bearer ' + process.env.TMBD_ACCES_TOKEN
  }
};

//Schemas
const userSchema = new mongoose.Schema({
  email:  { type: String, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true }
});

const listSchema = new mongoose.Schema({
  userids: { userid: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true  } },
  listName: { type: String, required: true },
  items: [{ itemid: { type: String, required: true },
            type: { type: String, required: true } }]
});

const User = mongoose.model("User", userSchema);
const List = mongoose.model("List", listSchema);
app.use(async (req, res, next) => {
  await connectDB();
  next();
});


app.get("/", function(req, res) {
   res.render("index",{ userid: userid});
});

app.post("/login", async function (req, res) {
    const userf = await User.findOne({ username: req.body.username });
    if (userf != null) {
        if (userf.password === req.body.password) {
            req.session.userid = userf._id;
            let userList = await List.findOne({ "userids.userid": req.session.userid });
            let items = [];
            if (userList) {
                items = await Promise.all(userList.items.map(item => idToItem(item.itemid, item.type)));
            }
            res.render("primary", { userid: req.session.userid, items: items });
        } else {
            res.render("login", { error: "Incorrect password.", username: req.body.username });
        }
    } else {
        res.render("login", { error: "User not found.", username: req.body.username });
    }
});

app.post("/signup", async function(req, res) {
    let errores = checkPassword(req.body.password, req.body.confirm_password,req);
    if (errores.length > 0) {
        console.log(errores);
        res.render("signup", { errores: errores, email: req.body.email, username: req.body.username });
        return;
    }else {
        let nuevo = await User.create({ email: req.body.email, username: req.body.username, password: req.body.password });
        console.log(nuevo);
        req.session.userid = nuevo._id;
        res.render("primary", { userid: req.session.userid });
    }
});

//Search
app.post("/searchmovies", async function(req, res) {
    const searchQuery = req.body.searchQuery;
    const url = urldefault + "/search/multi?query=" + req.body.searchQuery + "&include_adult=false&language=en-US&page=1";
    try {
        const response = await fetch(url, tmdbOptions);
        const dataMovies = await response.json();
        const results = dataMovies.results;
        console.log(results);
        res.render("search", { userid: req.session.userid, results: results, searchQuery: searchQuery });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error searching for movies.");
    }
});

app.post("/addMovieToList", async function(req, res) {
    const { id, mediaType } = req.body;
    if (!req.session.userid) {
        return res.status(401).json({ success: false, message: "You must be logged in to add items." });
    }

    try {
        let userList = await List.findOne({ "userids.userid": req.session.userid.toString() });

        if (!userList) {
            userList = await List.create({
                userids: { userid: req.session.userid},
                listName: "Personal List",
                items: [{ itemid: id, type: mediaType }]
            });
            return res.status(201).json({ success: true, message: "List created and item added successfully!" });
        }

        const itemExists = userList.items.some(item => item.itemid === id);
        if (itemExists) {
            return res.status(400).json({ success: false, message: "This item is already in your list." });
        }

        userList.items.push({ itemid: id, type: mediaType });
        await userList.save();

        return res.status(200).json({ success: true, message: "Item added to your list!" });

    } catch (error) {
        console.error("Error adding to list:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

//Rutas
app.get("/primary", async function(req, res) {
    let userList = await List.findOne({ "userids.userid": req.session.userid.toString() });
    let items = [];
    if (userList) {
        items = await Promise.all(userList.items.map(item => idToItem(item.itemid, item.type)));
    }
    res.render("primary", { userid: req.session.userid, items: items });
});

app.get("/signup", function(req, res) {
    res.render("signup");
});

app.get("/login", function(req, res) {
    res.render("login");
});

app.get("/newList", function(req, res) {
    res.render("newList", { userid: req.session.userid });
});

app.get("/search", function(req, res) {
    res.render("search", { userid: req.session.userid });
});

//Funciones

function checkPassword(password, confirmPassword,req) {
    let errores = [];

   if (password.length < 10 || password.length > 20){
      errores.push("Password must be between 10 and 20 characters.");
   }

   let pas1Reg = /[a-z]/;
   if (!pas1Reg.test(password)){
      errores.push("Password must contain at least one lowercase character.");
   }

   let pas2Reg = /[A-Z]/;
   if (!pas2Reg.test(password)) {
      errores.push("Password must contain at least one uppercase character.");
   }

   let pas3Reg = /[0-9]/;
   if (!pas3Reg.test(password)) {
      errores.push("Password must contain at least one digit.");
   }

   if (password != confirmPassword) {
      errores.push("Password and confirmation password don't match.");
   }

   return errores;
}

async function idToItem(id, type) {
    try {
        const url = `${urldefault}/${type}/${id}?language=en-US`;
        const response = await fetch(url, tmdbOptions);
        const data = await response.json();
        data.type = type; // <-- AÑADIR EL TIPO AQUÍ
        return data;
    } catch (error) {
        console.error("Error fetching item by ID:", error);
        return null;
    }
}
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
}
module.exports = app
