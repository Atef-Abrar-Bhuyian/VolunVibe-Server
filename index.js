require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

// whitelisted URL's
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://volunvibe.web.app",
    "https://volunvibe.firebaseapp.com",
  ],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.68dnu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Verify Token
const verifyToke = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }

  jwt.verify(token, process.env.SECRET_TOKEN_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized Access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    const needVolunteer = client.db("volunteerDB").collection("needVolunteer");
    const volunteerRequest = client
      .db("volunteerDB")
      .collection("volunteerRequest");

    // generate JWT
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      // create token
      const token = jwt.sign(email, process.env.SECRET_TOKEN_KEY, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // logout and clear cookie from browser
    app.get("/jwtLogout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // get all volunteer post
    app.get("/needVolunteer", async (req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const search = req.query.search || "";
      let query = {
        postTitle: {
          $regex: search,
          $options: "i",
        },
      };
      const cursor = needVolunteer
        .find(query)
        .skip(page * size)
        .limit(size);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/needVolunteerSort", async (req, res) => {
      try {
        const { sortBy = "deadline", order = "asc" } = req.query;

        // Define sorting order (1 for ascending, -1 for descending)
        const sortOrder = order === "desc" ? -1 : 1;

        // Query database with sorting
        const result = await needVolunteer
          .find()
          .sort({ [sortBy]: sortOrder })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching sorted volunteer posts:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // get all post count for pagination
    app.get("/totalNumberOfPosts", async (req, res) => {
      const count = await needVolunteer.estimatedDocumentCount();
      res.send({ count });
    });

    // get volunteer post by close deadline
    app.get("/topNeedVolunteer", async (req, res) => {
      const cursor = needVolunteer.find().sort({ deadline: 1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get specific volunteer post
    app.get("/volunteerPost/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await needVolunteer.findOne(query);
      res.send(result);
    });

    // add a post
    app.post("/addPost", async (req, res) => {
      const newPost = req.body;
      const result = await needVolunteer.insertOne(newPost);
      res.send(result);
    });

    // add volunteer request
    app.post("/volunteerRequest", async (req, res) => {
      // save a post in db
      const newRequest = req.body;
      const result = await volunteerRequest.insertOne(newRequest);

      // decrease number of volunteer
      const filter = { _id: new ObjectId(newRequest.PostId) };
      const update = {
        $inc: { noOfVolunteersNeeded: -1 },
      };
      const updateVolunteerNumber = await needVolunteer.updateOne(
        filter,
        update
      );

      res.send(result);
    });

    // get requested volunteers
    app.get("/volunteerRequest", async (req, res) => {
      const cursor = volunteerRequest.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // get all post that posted by a specific user
    app.get("/post/:email", verifyToke, async (req, res) => {
      const decodedEmail = req.user?.email;
      const email = req.params.email;
      const query = { organizerEmail: email };

      if (decodedEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const result = await needVolunteer.find(query).toArray();
      res.send(result);
    });

    // get all request post that request by a specific user
    app.get("/requesPost/:email", verifyToke, async (req, res) => {
      const decodedEmail = req.user?.email;
      const email = req.params.email;
      const query = { volunteerEmail: email };

      if (decodedEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const result = await volunteerRequest.find(query).toArray();
      res.send(result);
    });

    // Update a post in db
    app.put("/updatePost/:id", verifyToke, async (req, res) => {
      const id = req.params.id;
      const postData = req.body;

      // verify User Token
      if (req.user?.email !== postData.organizerEmail) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const updated = {
        $set: postData,
      };
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const result = await needVolunteer.updateOne(query, updated, options);
      res.send(result);
    });

    // delete a post from db
    app.delete("/post/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await needVolunteer.deleteOne(query);
      res.send(result);
    });

    // delete a request from db and update the number of volunteers needed
    app.delete("/requestPost/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      // Fetch the request details
      const specificRequest = await volunteerRequest.findOne(query);

      // Update the corresponding post's volunteer count
      const filter = { _id: new ObjectId(specificRequest.PostId) };
      const update = {
        $inc: { noOfVolunteersNeeded: 1 },
      };
      await needVolunteer.updateOne(filter, update);

      // Delete the request
      const result = await volunteerRequest.deleteOne(query);
      res.send(result);
    });

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("VolunVibe Server Is Running!");
});

app.listen(port, () => {
  console.log(`Example app listening on port: ${port}`);
});
