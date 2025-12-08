

import express from "express"
import User from "../models/user.js"
const router = express.Router();

// ----------------------
// Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { username, avatar, frame } = req.body;

    if (!username) {
      return res.status(400).json({ message: "username and avatar are required" });
    }

    const isExist = await User.findOne({username})
    if(isExist) return res.status(400).json({ message: "Username already exists" });

    const user = new User({ username, frame, avatar });
    await user.save();

    res.json({ message: "Signup successful", user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------
// Update Profile Route
// ----------------------
router.post("/update", async (req, res) => {
  try {
    const { username, avatar, frame } = req.body;

    if (!username) {
      return res.status(400).json({ message: "username and avatar required" });
    }

  const user = await User.findOne({username:username})

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if(avatar) user.avatar = avatar
    if(frame)  user.frame = frame

    await user.save({new:true})

    res.json({ message: "Profile updated", user: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/time", async (req, res)=>{
  const date = Date.now()
  return res.status(200).json({ date});
})

router.get("/user", async (req, res)=>{
  const { username } = req.body

  const user = await User.findOne({username})

  if(!user){
    return res.status(404).json({message:"user not found with this username"})
  }

  return res.status(200).json({user})


})

export default router;
