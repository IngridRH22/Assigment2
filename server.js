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
    secure: false,
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

//Hash
const bcrypt = require("bcryptjs");

//Schemas
const userSchema = new mongoose.Schema({
  email:  { type: String, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true }
});

const listSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Compatibilidad con listas antiguas
  userids: { userid: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
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

function toArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function userCanAccessList(list, userid) {
  if (!list || !userid) return false;
  const uid = String(userid);
  if (list.owner && String(list.owner) === uid) return true;
  if (Array.isArray(list.members) && list.members.some(m => String(m) === uid)) return true;
  if (list.userids && list.userids.userid && String(list.userids.userid) === uid) return true;
  return false;
}

function findListsQuery(userid) {
  return {
    $or: [
      { owner: userid },
      { members: userid },
      { "userids.userid": userid }
    ]
  };
}

async function getAccessibleLists(userid) {
  return List.find(findListsQuery(userid)).sort({ listName: 1 });
}

async function normalizeListAccess(list) {
  if (!list) return list;
  let changed = false;
  if (!list.owner && list.userids && list.userids.userid) {
    list.owner = list.userids.userid;
    changed = true;
  }
  if (!Array.isArray(list.members)) {
    list.members = [];
    changed = true;
  }
  if (list.owner && !list.members.some(m => String(m) === String(list.owner))) {
    list.members.push(list.owner);
    changed = true;
  }
  if (changed) {
    try { await list.save(); } catch (e) { console.error("List normalize error:", e.message); }
  }
  return list;
}

async function getListForUser(listId, userid) {
  if (listId) {
    const list = await List.findById(listId);
    if (list && userCanAccessList(list, userid)) return normalizeListAccess(list);
    return null;
  }
  const lists = await getAccessibleLists(userid);
  if (!lists[0]) return null;
  return normalizeListAccess(lists[0]);
}

function getItemGenreIds(item) {
  if (!item) return [];
  if (Array.isArray(item.genre_ids)) return item.genre_ids.map(Number);
  if (Array.isArray(item.genres)) return item.genres.map(g => Number(g.id));
  return [];
}

function filterItems(items, mediaTypes, genreIds) {
  return items.filter(item => {
    if (!item) return false;
    const typeOk = mediaTypes.length === 0 || mediaTypes.includes(item.type) || mediaTypes.includes(item.media_type);
    if (!typeOk) return false;
    if (genreIds.length === 0) return true;
    const itemGenres = getItemGenreIds(item);
    return genreIds.some(g => itemGenres.includes(Number(g)));
  });
}

async function loadPrimaryData(userid, options = {}) {
  const mediaTypes = toArray(options.mediaType);
  const genreIds = toArray(options.genres);
  const lists = await getAccessibleLists(userid);
  let selectedList = null;

  if (options.listId) {
    selectedList = lists.find(l => String(l._id) === String(options.listId)) || null;
  }
  if (!selectedList && lists.length > 0) {
    selectedList = lists[0];
  }
  if (selectedList) {
    selectedList = await normalizeListAccess(selectedList);
  }

  let items = [];
  let members = [];
  if (selectedList) {
    items = await Promise.all(selectedList.items.map(item => idToItem(item.itemid, item.type)));
    items = filterItems(items.filter(Boolean), mediaTypes, genreIds);

    const memberIds = new Set();
    if (selectedList.owner) memberIds.add(String(selectedList.owner));
    (selectedList.members || []).forEach(m => memberIds.add(String(m)));
    if (selectedList.userids && selectedList.userids.userid) {
      memberIds.add(String(selectedList.userids.userid));
    }
    members = await User.find({ _id: { $in: Array.from(memberIds) } }).select("username email");
  }

  return {
    userid,
    lists,
    selectedList,
    listId: selectedList ? selectedList._id : null,
    listName: selectedList ? selectedList.listName : "My List",
    members,
    items,
    mediaType: mediaTypes,
    genres: genreIds
  };
}

app.get("/", function(req, res) {
   res.render("index",{ userid: req.session.userid});
});

app.post("/login", async function (req, res) {
    const userf = await User.findOne({ username: req.body.username });
    if (userf != null) {
        if (await bcrypt.compare(req.body.password, userf.password)) {
            req.session.userid = userf._id;
            const data = await loadPrimaryData(req.session.userid);
            res.render("primary", data);
        } else {
            res.render("login", { error: "Incorrect password.", username: req.body.username });
        }
    } else {
        res.render("login", { error: "User not found.", username: req.body.username });
    }
});

app.post("/logout", function(req, res) {
    req.session.destroy();
    res.redirect("/");
});

app.post("/signup", async function(req, res) {
    let errores = checkPassword(req.body.password, req.body.confirm_password,req);
    if (errores.length > 0) {
        console.log(errores);
        res.render("signup", { errores: errores, email: req.body.email, username: req.body.username });
        return;
    }else {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        let nuevo = await User.create({ email: req.body.email, username: req.body.username, password: hashedPassword });
        console.log(nuevo);
        req.session.userid = nuevo._id;
        await List.create({
            owner: nuevo._id,
            members: [nuevo._id],
            listName: "Personal List",
            items: []
        });
        const data = await loadPrimaryData(req.session.userid);
        res.render("primary", data);
    }
});

//Acount
app.post("/updateAccount", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }

    try {
        const user = await User.findById(req.session.userid);
        if (!user) {
            return res.status(404).send("User not found.");
        }

        if (req.body.username) {
            user.username = req.body.username;
        }
        if (req.body.email) {
            user.email = req.body.email;
        }

        await user.save();
        res.redirect("/account");
    } catch (error) {
        console.error("Error updating account:", error);
        res.status(500).send("Internal server error.");
    }
});

app.post("/deleteAccount", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }

    try {
        const user = await User.findById(req.session.userid);
        if (!user) {
            return res.status(404).send("User not found.");
        }

        await List.deleteMany({ owner: req.session.userid });
        await List.updateMany(
          { members: req.session.userid },
          { $pull: { members: req.session.userid } }
        );
        await List.deleteMany({ "userids.userid": req.session.userid, owner: { $exists: false } });
        await User.deleteOne({ _id: req.session.userid });
        req.session.destroy();
        res.redirect("/signup");
    } catch (error) {
        console.error("Error deleting account:", error);
        res.status(500).send("Internal server error.");
    }
});

app.post("/updatePassword", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }

    try {
        const user = await User.findById(req.session.userid);
        if (!user) {
            return res.status(404).send("User not found.");
        }

        const Match = await bcrypt.compare(req.body.current_password, user.password);
        if (!Match) {
            return res.status(400).send("Current password is incorrect.");
        }
        const hashedPassword = await bcrypt.hash(req.body.new_password, 10);
        await User.updateOne({ _id: user._id }, { password: hashedPassword } );
        res.render("account", { user: user, userid: req.session.userid });
    } catch (error) {
        console.error("Error updating password:", error);
        res.status(500).send("Internal server error.");
    }
});

//Search
app.post("/searchmovies", async function(req, res) {
    const searchQuery = req.body.searchQuery;
    const mediaTypes = toArray(req.body.mediaType);
    const genreIds = toArray(req.body.genres);
    const url = urldefault + "/search/multi?query=" + encodeURIComponent(req.body.searchQuery) + "&include_adult=false&language=en-US&page=1";
    try {
        const response = await fetch(url, tmdbOptions);
        const dataMovies = await response.json();
        let results = dataMovies.results || [];
        results = results.map(r => ({ ...r, type: r.media_type }));
        results = filterItems(results, mediaTypes, genreIds);
        res.render("search", {
          userid: req.session.userid,
          results,
          searchQuery,
          mediaType: mediaTypes,
          genres: genreIds
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error searching for movies.");
    }
});

app.get("/api/lists", async function(req, res) {
    if (!req.session.userid) {
        return res.status(401).json({ success: false, message: "You must be logged in." });
    }
    try {
        const lists = await getAccessibleLists(req.session.userid);
        return res.json({
          success: true,
          lists: lists.map(l => ({ _id: l._id, listName: l.listName }))
        });
    } catch (error) {
        console.error("Error fetching lists:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});

//add
app.post("/addMovieToList", async function(req, res) {
    console.log("Received request to add item:", req.body);
    const { id, mediaType, listId, newListName } = req.body;
    if (!req.session.userid) {
        return res.status(401).json({ success: false, message: "You must be logged in to add items." });
    }

    try {
        let userList = null;

        if (newListName && String(newListName).trim()) {
            userList = await List.create({
                owner: req.session.userid,
                members: [req.session.userid],
                listName: String(newListName).trim(),
                items: [{ itemid: String(id), type: mediaType }]
            });
            return res.status(201).json({
              success: true,
              message: "List created and item added successfully!",
              listId: userList._id
            });
        }

        if (listId) {
            userList = await getListForUser(listId, req.session.userid);
        } else {
            userList = await getListForUser(null, req.session.userid);
        }

        if (!userList) {
            userList = await List.create({
                owner: req.session.userid,
                members: [req.session.userid],
                listName: "Personal List",
                items: [{ itemid: String(id), type: mediaType }]
            });
            return res.status(201).json({ success: true, message: "List created and item added successfully!" });
        }

        const itemExists = userList.items.some(item => String(item.itemid) === String(id));
        if (itemExists) {
            return res.status(400).json({ success: false, message: "This item is already in your list." });
        }

        userList.items.push({ itemid: String(id), type: mediaType });
        await userList.save();

        return res.status(200).json({ success: true, message: "Item added to your list!" });

    } catch (error) {
        console.error("Error adding to list:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

//remove
app.post("/remMoviefromList", async function(req, res) {
    const { id, listId } = req.body;
    if (!req.session.userid) {
        return res.status(401).json({ success: false, message: "You must be logged in to remove items." });
    }

    try {
        let userList = await getListForUser(listId, req.session.userid);

        if (!userList) {
            return res.status(404).json({ success: false, message: "List not found." });
        }

        const itemIndex = userList.items.findIndex(item => String(item.itemid) === String(id));
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: "Item not found in your list." });
        }

        userList.items.splice(itemIndex, 1);
        await userList.save();

        return res.status(200).json({ success: true, message: "Item removed from your list!" });

    } catch (error) {
        console.error("Error removing from list:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

app.post("/newList", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }
    const listName = (req.body.listName || "").trim();
    if (!listName) {
        return res.render("newList", { userid: req.session.userid, error: "List name is required." });
    }
    const created = await List.create({
        owner: req.session.userid,
        members: [req.session.userid],
        listName,
        items: []
    });
    res.redirect("/primary?listId=" + created._id);
});

app.post("/addMemberToList", async function(req, res) {
    if (!req.session.userid) {
        return res.status(401).json({ success: false, message: "You must be logged in." });
    }

    const { listId, username } = req.body;
    if (!listId || !username) {
        return res.status(400).json({ success: false, message: "List and username are required." });
    }

    try {
        const list = await getListForUser(listId, req.session.userid);
        if (!list) {
            return res.status(404).json({ success: false, message: "List not found." });
        }

        const userToAdd = await User.findOne({ username: String(username).trim() });
        if (!userToAdd) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (userCanAccessList(list, userToAdd._id)) {
            return res.status(400).json({ success: false, message: "User already has access to this list." });
        }

        if (!list.owner && list.userids && list.userids.userid) {
            list.owner = list.userids.userid;
        }
        if (!Array.isArray(list.members)) {
            list.members = [];
        }
        if (list.owner && !list.members.some(m => String(m) === String(list.owner))) {
            list.members.push(list.owner);
        }
        list.members.push(userToAdd._id);
        await list.save();

        return res.status(200).json({
          success: true,
          message: userToAdd.username + " was added to the list.",
          member: { username: userToAdd.username, email: userToAdd.email }
        });
    } catch (error) {
        console.error("Error adding member:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});

//Rutas
app.post("/primary", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }
    const data = await loadPrimaryData(req.session.userid, {
      listId: req.body.listId,
      mediaType: req.body.mediaType,
      genres: req.body.genres
    });
    res.render("primary", data);
});

app.get("/primary", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }
    const data = await loadPrimaryData(req.session.userid, {
      listId: req.query.listId,
      mediaType: req.query.mediaType,
      genres: req.query.genres
    });
    res.render("primary", data);
});

app.get("/movie/:id", async function(req, res) {
    const item = await idToItem(req.params.id, "movie");
    if (!item || item.success === false) {
        return res.status(404).send("Movie not found.");
    }
    res.render("detail", { userid: req.session.userid, item, mediaKind: "movie" });
});

app.get("/tv/:id", async function(req, res) {
    const item = await idToItem(req.params.id, "tv");
    if (!item || item.success === false) {
        return res.status(404).send("TV show not found.");
    }
    res.render("detail", { userid: req.session.userid, item, mediaKind: "tv" });
});

app.get("/signup", function(req, res) {
    res.render("signup");
});

app.get("/login", function(req, res) {
    res.render("login");
});

app.get("/newList", function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }
    res.render("newList", { userid: req.session.userid });
});

app.get("/search", function(req, res) {
    res.render("search", { userid: req.session.userid, mediaType: [], genres: [] });
});

app.get("/account", async function(req, res) {
    if (!req.session.userid) {
        return res.redirect("/login");
    }
    const user = await User.findById(req.session.userid);
    if (!user) {
        return res.redirect("/login");
    }
    res.render("account", { user: user, userid: req.session.userid });
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
        data.type = type;
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
