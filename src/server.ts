import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chat-app")
  .then(() => console.log("Connected to mongodb at http://localhost:27017"))
  .catch((err) => console.error("MongoDb connection error: ", err));

app.use("/", (req, res) => {
  res.send("Chat Application is running!!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
