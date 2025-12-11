import express from "express";
import User from "../models/user.js";
import crypto from "crypto";
import Level from "../models/level.js";
const router = express.Router();

// ----------------------
// Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { username, avatar_index, frame_index } = req.body;

    if (!username) {
      return res
        .status(400)
        .json({ message: "username and avatar_index are required" });
    }

    const isExist = await User.findOne({ username });
    if (isExist)
      return res.status(400).json({ message: "Username already exists" });

    const playerId = crypto.randomBytes(16).toString("hex");

    const user = new User({ username, frame_index, avatar_index, playerId });
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

    if (!user || user.username == username) {
      return res
        .status(404)
        .json({ message: "User not found or username already exists" });
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

router.get("/time", async (req, res) => {
  const date = Date.now();
  return res.status(200).json({ data: { date } });
});

router.get("/user", async (req, res) => {
  // Assuming playerId is correctly passed in the request body, as shown in your original code.
  // NOTE: For GET requests, query parameters (req.query) are often preferred over req.body.
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ message: "email is required" });
  }

  try {
    const projection = {
        // Include fields
        username: 1,
        avatar_index: 1,
        frame_index: 1,
        playerId: 1,
        // Include specific nested fields
        'levels.easy.current_level': 1,
        'levels.medium.current_level': 1,
        'levels.hard.current_level': 1,
        'levels.expert.current_level': 1,
        // Exclude fields (Mongoose includes _id by default unless you explicitly exclude it)
        // We will keep the main _id for potential client use.
    };

    const user = await User.findOne({ email })
      .select(projection) // Apply the projection
      .lean(); // Use .lean() for faster query performance since we don't need Mongoose documents

    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found with this playerId" });
    }

    // --- Optional: Re-structure the levels object for a flatter response (cleaner client use) ---
    const formattedUser = {
        _id: user._id,
        username: user.username,
        avatar_index: user.avatar_index,
        frame_index: user.frame_index,
        playerId: user.playerId,
        email: user.email
        // current_levels: {
        //     easy: user.levels.easy?.current_level || 0,
        //     medium: user.levels.medium?.current_level || 0,
        //     hard: user.levels.hard?.current_level || 0,
        //     expert: user.levels.expert?.current_level || 0,
        // }
    };

    return res.status(200).json({ user: formattedUser });

  } catch (err) {
    console.error("Error fetching user data:", err);
    res.status(500).json({ error: "Server error while retrieving user data", err });
  }
});

// Assume 'User' and 'Level' models are imported and 'router' is an Express router

// Corrected and improved /level-complete route
router.post("/level-complete", async (req, res) => {
  try {
    const { playerId, mode, level, time } = req.body;

    // ... (Input Validation and User Retrieval - Kept as is) ...

    if (!playerId || !mode || level === undefined || time === undefined) {
      return res
        .status(400)
        .json({
          message: "Missing required fields: playerId, mode, level, time",
        });
    }

    // if (!["easy", "medium", "hard", "expert"].includes(mode)) {
    //   return res.status(400).json({ message: "Invalid mode provided" });
    // }

    const user = await User.findOne({ playerId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const progress = user.levels[mode];
    const requestedLevel = Number(level);
    const timeTaken = Number(time);

    // ... (Progression Logic - Kept as is) ...

    const expectedLevel = progress.current_level + 1;

    // if (requestedLevel < expectedLevel) {
    //   return res.status(400).json({
    //     message: `Level ${requestedLevel} in ${mode} mode is already completed. Current level is ${expectedLevel}.`,
    //   });
    // }

    // if (requestedLevel > expectedLevel) {
    //   return res.status(400).json({
    //     message: `You must complete level ${expectedLevel} before attempting level ${requestedLevel}.`,
    //   });
    // }

    // 2-4. Update user's progress and save
    progress.level_times.set(requestedLevel.toString(), timeTaken);
    progress.current_level = expectedLevel;
    const times = [...progress.level_times.values()];
    const totalTime = times.reduce((a, b) => a + b, 0);
    progress.average_time = times.length > 0 ? totalTime / times.length : 0;
    await user.save();

    // 5. Update Global Level Stats (Level Schema) - **This handles creation!**
    let globalLevelStats = await Level.findOneAndUpdate(
      { mode, level: requestedLevel }, // Query to find the existing level document
      {
        // $inc will initialize fields to 0 if the document is new
        $inc: { total_time: timeTaken, attempts: 1 },
        // If the document is created (upserted), explicitly set the mode and level
        $setOnInsert: { mode: mode, level: requestedLevel }
      },
      {
        new: true,   // Return the updated (or newly created) document
        upsert: true // ⭐ This ensures creation if the document is not found!
      }
    );

    // 6. Update global average time (calculated server-side for accuracy)
    // The total_time and attempts are updated by $inc, now we can calculate the average.
    // We use total_time and attempts from the returned document (globalLevelStats)
    if (globalLevelStats.attempts > 0) {
      globalLevelStats.average_time = globalLevelStats.total_time / globalLevelStats.attempts;
    } else {
      globalLevelStats.average_time = 0;
    }

    // Save the document to persist the newly calculated average_time
    await globalLevelStats.save();

    return res.json({
      message: "Level completed and progress updated!",
      // next_level: progress.current_level + 1,
      average: globalLevelStats.average_time,
    });
  } catch (err) {
    console.error("Error in /level-complete:", err);
    res.status(500).json({ error: "Server error during level completion" });
  }
});

// Assume 'User' model is imported and 'router' is an Express router

router.post("/leader", async (req, res) => {
  try {
    const { mode, limit, order, level } = req.body; // <-- Added 'level'

    // --- Input Validation ---
    // if (!["easy", "medium", "hard", "expert"].includes(mode)) {
    //   return res.status(400).json({ message: "Invalid mode provided" });
    // }
    if (level === undefined || isNaN(parseInt(level, 10))) {
      return res.status(400).json({ message: "Level number is required and must be a valid number" });
    }
    const levelStr = String(level); // Map keys are stored as strings

    const leaderboardLimit = parseInt(limit, 10) || 10; // Default limit
    // Sort order: 1 for ascending (lowest time first), -1 for descending
    const sortOrder = order === "dec" ? -1 : 1;
    const sortDirection = { time_taken: sortOrder };

    // --- Aggregation Pipeline ---
    const pipeline = [
      // 1. Filter out users who haven't completed the requested level in the mode
      {
        $match: {
          [`levels.${mode}.level_times.${levelStr}`]: { $gt: 0 } // Check for time > 0 for the specific level
        }
      },
      // 2. Add a computed field to easily access the time taken for the specific level
      {
        $addFields: {
          time_taken: `$levels.${mode}.level_times.${levelStr}`
        }
      },
      // 3. Sort the results based on the time taken
      {
        $sort: sortDirection // Sorts by 'time_taken'
      },
      // 4. Limit the number of documents
      {
        $limit: leaderboardLimit
      },
      // 5. Project (select) the final fields to send back to the client
      {
        $project: {
          _id: 0,
          username: 1,
          avatar_index: 1,
          frame_index: 1,
          time_taken: 1 // The specific level time
        }
      }
    ];

    const leaderboard = await User.aggregate(pipeline);

    // --- Re-format the output for the client ---
    const formattedUsers = leaderboard.map(user => ({
      username: user.username,
      avatar_index: user.avatar_index,
      frame_index: user.frame_index,
      // Renamed from average_time to level_time for clarity
      level_time: user.time_taken
    }));

    res.json(formattedUsers);

  } catch (err) {
    console.error("Error in /leader:", err);
    res.status(500).json({ error: "Server error during leaderboard retrieval" });
  }
});



router.post("/user-rank", async (req, res) => {
  try {
    const { playerId, mode, level } = req.body;

    // --- 1. Input Validation ---
    if (!playerId || !mode || level === undefined || isNaN(parseInt(level, 10))) {
      return res.status(400).json({
        message: "Missing required fields: playerId, mode, and a valid level number",
      });
    }

    const levelStr = String(level); // Map keys are stored as strings
    // Path for MongoDB Aggregation (CORRECT for your schema)
    const userLevelTimePath = `levels.${mode}.level_times.${levelStr}`;

    // --- 2. Find the current user's time ---
    const user = await User.findOne(
      { playerId },
      { [userLevelTimePath]: 1, username: 1 } // Only fetch the required time and username
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 🔥 FIX: Correctly access the deeply nested time value on the Mongoose Document
    // levels[mode] is a subdocument (standard object access)
    // .level_times is a Map (use .get(key) access)
    const userTime = user.levels?.[mode]?.level_times?.get(levelStr); 
    // The optional chaining (?. ) helps prevent crashes if the mode subdocument doesn't exist.

    if (userTime === undefined || userTime === 0) {
      return res.status(404).json({
        message: `data not found`,
      });
    }

    // --- 3. Aggregation to find the rank (This logic is correct for your schema) ---

    // The rank is 1 + (Count of all users with a BETTER time (time < userTime))
    const betterUsersCount = await User.aggregate([
      // 1. Filter: Find all users who completed this level
      {
        $match: {
          [userLevelTimePath]: { $gt: 0 },
        },
      },
      // 2. Filter: Keep only users who have a time BETTER than the current user's time
      {
        $match: {
          [userLevelTimePath]: { $lt: userTime },
        },
      },
      // 3. Count: Count the number of users remaining (i.e., the number of people ranked above)
      {
        $count: "count",
      },
    ]);

    // The final rank is (count of better users) + 1 (the user themselves)
    const rankAbove = betterUsersCount.length > 0 ? betterUsersCount[0].count : 0;
    const userRank = rankAbove + 1;
    
    // --- 4. Get total players who completed the level (Optional, but useful for context) ---
    const totalPlayers = await User.countDocuments({
      [userLevelTimePath]: { $gt: 0 },
    });

    // --- 5. Return Response ---
    res.json({
      username: user.username,
      mode: mode,
      rank: userRank
    });

  } catch (err) {
    console.error("Error in /user-rank:", err);
    res.status(500).json({ error: "Server error during rank retrieval" });
  }
});
export default router;
