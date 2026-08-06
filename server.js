// Express
const express = require("express");
const app = express();
const path = require("path");

app.use(express.urlencoded({ extended: false }));

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

//Schemas
const userSchema = new mongoose.Schema({
  email:  { type: String, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

app.use(async (req, res, next) => {
  await connectDB();
  next();
});


app.get("/", function(req, res) {
   res.render("signup");
});

app.post("/login", function (req, res) {
    usuario = findUser(req.body.username);
    if (usuario) {
        if (usuario.password === req.body.password) {
            res.render("primary");
        } else {
            res.render("login", { error: "Incorrect password." });
        }
    } else {
        res.render("login", { error: "User not found." });
    }
});

app.post("/signup", function(req, res) {
    let errores = checkPassword(req.body.password, req.body.confirm_password,req);
    if (errores.length > 0) {
        console.log(errores);
        res.render("signup", { errores: errores });
        return;
    }else {
        let prueba = createUser(req.body.email, req.body.username, req.body.password, req.body.confirm_password);
        console.log(prueba);
        res.render("primary");
    }
});

app.get("/palogin", function(req, res) {
    res.render("login");
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

async function createUser(email, username, password, confirmPassword) {
    let nuevo = await User.create({ email: email, username: username, password: password });
    return nuevo;
}

async function findUser(username) {
    const userf = await User.findOne({ username: username });
    return userf;
}

module.exports = app