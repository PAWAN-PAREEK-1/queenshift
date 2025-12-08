

import express from "express"
import User from "../models/user.js"
const router = express.Router();

// ----------------------
// Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { username, avatar_index, frame_index } = req.body;

    if (!username) {
      return res.status(400).json({ message: "username and avatar_index are required" });
    }

    const isExist = await User.findOne({username})
    if(isExist) return res.status(400).json({ message: "Username already exists" });

    const user = new User({ username, frame_index, avatar_index });
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
    const { userId, username, avatar_index, frame_index } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update fields ONLY if provided (even if value === 0)
    if (typeof username !== "undefined") user.username = username;
    if (typeof avatar_index !== "undefined") user.avatar_index = avatar_index;
    if (typeof frame_index !== "undefined") user.frame_index = frame_index;

    await user.save(); // no { new: true } needed

    res.json({ message: "Profile updated", user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/time", async (req, res)=>{
  const date = Date.now()
  return res.status(200).json({data: {date}});
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
