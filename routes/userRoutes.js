import express from "express";
import User from "../models/user.js";
import crypto from "crypto";
import Level from "../models/level.js";
import { connectDB } from "../models/db.js";
import transaction from "../models/transaction.js";
import { LEAGUES } from "../leagueRules.js";
import LeagueProgress from "../models/LeagueProgress.js";
const router = express.Router();



export function calculateLeague(score) { const match = LEAGUES.find( l => score >= l.min && score <= l.max ); return match || { name: "bronze", level: 3 }; }

// ----------------------
// Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    await connectDB();
    const { username, avatar_index, frame_index, email } = req.body;

   if (!username) {
      return res.status(400).json({
        message: "username is required"
      });
    }

    // Build OR condition dynamically
    const orConditions = [{ username }];

    if (email) {
      orConditions.push({ email });
    }

    const isExist = await User.findOne({
      $or: orConditions
    });

    if (isExist) {
      return res.status(400).json({
        message: "Username  already exists"
      });
    }

    const playerId = crypto.randomBytes(16).toString("hex");

    const user = new User({ username, frame_index, avatar_index, playerId, email });
    await user.save();

    res.json({ message: "Signup successful", username: user.username, frame_index:user.frame_index, avatar_index:user.avatar_index, playerId:user.playerId, email:user.email  });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------
// Update Profile Route
// ----------------------
router.post("/update", async (req, res) => {
  try {
    await connectDB();
    const { playerId, username, avatar_index, frame_index } = req.body;
    const userId = playerId
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // find user
    const user = await User.findOne({playerId:userId});
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
     if (typeof username !== "undefined" && username !== user.username) {
      const usernameExists = await User.findOne({ username });
      if (usernameExists) {
        return res.status(409).json({ message: "Username already exists" });
      }
      user.username = username;
    }

    // Update fields ONLY if provided (even if value === 0)
    if (typeof username !== "undefined" && user.username != username) user.username = username;
    if (typeof avatar_index !== "undefined") user.avatar_index = avatar_index;
    if (typeof frame_index !== "undefined") user.frame_index = frame_index;

    await user.save(); // no { new: true } needed

        res.json({ message: "Profile Update", username: user.username, frame_index:user.frame_index, avatar_index:user.avatar_index, playerId:user.playerId, email:user.email  });

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
  await connectDB();

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
        .json({ message: "User not found with this email" });
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
    await connectDB();

    const { playerId, mode, level, time } = req.body;

    // 1️⃣ Basic validation
    if (!playerId || !mode || level === undefined || time === undefined) {
      return res.status(400).json({
        message: "Missing required fields: playerId, mode, level, time",
      });
    }

    const requestedLevel = Number(level);
    const timeTaken = Number(time);

    if (Number.isNaN(requestedLevel) || Number.isNaN(timeTaken)) {
      return res.status(400).json({
        message: "Level and time must be valid numbers",
      });
    }

    // 2️⃣ Find user
    const user = await User.findOne({ playerId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const progress = user.levels[mode];
    if (!progress) {
      return res.status(400).json({ message: "Invalid mode provided" });
    }

    // 3️⃣ Overwrite level time (replay-safe)
    const levelKey = requestedLevel.toString();
    const isReplay = progress.level_times.has(levelKey);

    progress.level_times.set(levelKey, timeTaken);

    // 4️⃣ Advance level ONLY if this is the next new level
    if (!isReplay && requestedLevel === progress.current_level + 1) {
      progress.current_level = requestedLevel;
    }

    // 5️⃣ Recalculate user average (average of latest times per level)
    const times = [...progress.level_times.values()];
    const totalTime = times.reduce((a, b) => a + b, 0);
    progress.average_time = times.length > 0 ? totalTime / times.length : 0;

    await user.save();

    // 6️⃣ Update global per-attempt stats (analytics only)
    await Level.findOneAndUpdate(
      { mode, level: requestedLevel },
      {
        $inc: { total_time: timeTaken, attempts: 1 },
        $setOnInsert: { mode, level: requestedLevel },
      },
      { upsert: true }
    );

    // 7️⃣ OPTION A: Calculate GLOBAL AVERAGE FROM USERS (same as Mongo shell)
    const avgResult = await User.aggregate([
      {
        $match: {
          [`levels.${mode}.level_times.${requestedLevel}`]: { $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          averageTime: {
            $avg: `$levels.${mode}.level_times.${requestedLevel}`,
          },
        },
      },
    ]);

    const globalAverage =
      avgResult.length > 0 ? avgResult[0].averageTime : 0;

    // 8️⃣ Response
    return res.json({
      message: "Level completed and progress updated!",
      average: globalAverage,
    });

  } catch (err) {
    console.error("Error in /level-complete:", err);
    return res.status(500).json({
      error: "Server error during level completion",
    });
  }
});


// Assume 'User' model is imported and 'router' is an Express router

router.post("/leader", async (req, res) => {
  try {
    await connectDB();
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
     await connectDB();
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
      return res.status(200).json({ message: "User not found" });
    }

    // 🔥 FIX: Correctly access the deeply nested time value on the Mongoose Document
    // levels[mode] is a subdocument (standard object access)
    // .level_times is a Map (use .get(key) access)
    const userTime = user.levels?.[mode]?.level_times?.get(levelStr); 
    // The optional chaining (?. ) helps prevent crashes if the mode subdocument doesn't exist.

    if (userTime === undefined || userTime === 0) {
      return res.status(200).json({
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
      rank: userRank,
      time: userTime,
    });

  } catch (err) {
    console.error("Error in /user-rank:", err);
    res.status(500).json({ error: "Server error during rank retrieval" });
  }
});


router.post("/bulk-signup", async (req, res) => {
  try {
    await connectDB();
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        message: "users array is required"
      });
    }

    const operations = [];
    const skippedUsers = [];

    for (const user of users) {
      const { username, avatar_index, frame_index, email ,playerId} = user;

      if (!username) {
        skippedUsers.push({
          user,
          reason: "Username missing"
        });
        continue;
      }

      // Build user document safely
      const userDoc = {
        username,
        avatar_index: avatar_index ?? 0,
        frame_index: frame_index ?? 0,
        playerId: playerId ?? crypto.randomBytes(16).toString("hex")
      };

      // ONLY add email if provided
      if (email) {
        userDoc.email = email;
      }

      operations.push({
        insertOne: {
          document: userDoc
        }
      });
    }

    if (operations.length === 0) {
      return res.status(400).json({
        message: "No valid users to insert",
        skippedUsers
      });
    }

    let result;
    try {
      result = await User.bulkWrite(operations, { ordered: false });
    } catch (err) {
      // Ignore duplicate key errors but capture info
      if (err.code !== 11000) {
        throw err;
      }
      result = err.result;
    }

    res.json({
      message: "Bulk signup completed",
      insertedCount: result?.insertedCount || 0,
      skippedCount: skippedUsers.length,
      skippedUsers
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


router.post("/transaction", async (req, res) => {
  try {
    await connectDB();
    const { transactionId, time } = req.body;

    if (!transactionId || !time) {
      return res.status(400).json({
        message: "transactionId and time are required"
      });
    }

    const transactions = await transaction.create({
      transactionId,
      time
    });

    res.status(201).json({
      message: "transaction stored successfully",
      data: transactions
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "transaction already exists"
      });
    }

    res.status(500).json({
      error: err.message
    });
  }
});

router.get("/get-transaction", async (req, res) => {
  try {
    await connectDB();
    const { transactionId } = req.body;

    const transactions = await transaction.findOne(
      { transactionId },
      { _id: 0, transactionId: 1, time: 1 }
    );

    if (!transactions) {
      return res.status(404).json({
        message: "transaction not found"
      });
    }

    res.json({
      transactionId: transactions.transactionId,
      time: transactions.time
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

router.post("/bulk-level-complete", async (req, res) => {
  try {
    await connectDB();

    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        message: "records array is required"
      });
    }

    // 🔒 Safety limit for Vercel
    // if (records.length > 300) {
    //   return res.status(413).json({
    //     message: "Max 300 records per request"
    //   });
    // }

    const playerIds = records.map(r => r.playerId);

    // 1️⃣ Fetch all users in ONE query
    const users = await User.find({ playerId: { $in: playerIds } });
    const userMap = new Map(users.map(u => [u.playerId, u]));

    const userOps = [];
    const levelOpsMap = new Map(); // key = mode_level
    const skipped = [];

    for (const r of records) {
      const { playerId, mode, level, time } = r;

      if (!playerId || !mode || level === undefined || time === undefined) {
        skipped.push({ record: r, reason: "Missing fields" });
        continue;
      }

      const user = userMap.get(playerId);
      if (!user) {
        skipped.push({ record: r, reason: "User not found" });
        continue;
      }

      const progress = user.levels[mode];
      if (!progress) {
        skipped.push({ record: r, reason: "Invalid mode" });
        continue;
      }

      const requestedLevel = Number(level);
      const timeTaken = Number(time);

      // ---- User Progress Update ----
      progress.level_times.set(requestedLevel.toString(), timeTaken);
      progress.current_level = Math.max(
        progress.current_level,
        requestedLevel
      );

      const times = [...progress.level_times.values()];
      const totalTime = times.reduce((a, b) => a + b, 0);
      progress.average_time = totalTime / times.length;

      userOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              [`levels.${mode}`]: progress
            }
          }
        }
      });

      // ---- Global Level Stats (grouped) ----
      const key = `${mode}_${requestedLevel}`;

      if (!levelOpsMap.has(key)) {
        levelOpsMap.set(key, {
          mode,
          level: requestedLevel,
          total_time: 0,
          attempts: 0
        });
      }

      const entry = levelOpsMap.get(key);
      entry.total_time += timeTaken;
      entry.attempts += 1;
    }

    // 2️⃣ Execute USER bulk write
    if (userOps.length > 0) {
      await User.bulkWrite(userOps, { ordered: false });
    }

    // 3️⃣ Prepare LEVEL bulk write
    const levelOps = [];

    for (const entry of levelOpsMap.values()) {
      levelOps.push({
        updateOne: {
          filter: { mode: entry.mode, level: entry.level },
          update: {
            $inc: {
              total_time: entry.total_time,
              attempts: entry.attempts
            },
            $setOnInsert: {
              mode: entry.mode,
              level: entry.level
            }
          },
          upsert: true
        }
      });
    }

    if (levelOps.length > 0) {
      await Level.bulkWrite(levelOps, { ordered: false });
    }

    return res.json({
      message: "Bulk level completion processed",
      processed: records.length,
      skippedCount: skipped.length,
      skipped
    });

  } catch (err) {
    console.error("Bulk level error:", err);
    res.status(500).json({
      error: "Server error during bulk level completion"
    });
  }
});


router.post("/league/score-update", async (req, res) => {
  try {
    await connectDB();

    const { playerId, score } = req.body;

    if (!playerId || score === undefined) {
      return res.status(400).json({
        message: "playerId and score are required",
      });
    }

    const scoreToAdd = Number(score);
    if (Number.isNaN(scoreToAdd)) {
      return res.status(400).json({ message: "Invalid score" });
    }

    // 1️⃣ Find or create progress
    let progress = await LeagueProgress.findOne({ playerId });
    if (!progress) {
      progress = new LeagueProgress({ playerId });
    }

    // 2️⃣ Update score
    progress.total_score += scoreToAdd;

    // 3️⃣ Update league
    progress.league = calculateLeague(progress.total_score);

    await progress.save();

    // 4️⃣ Response (ONLY user info)
    return res.json({
      playerId,
      total_score: progress.total_score,
      league: progress.league,
    });

  } catch (err) {
    console.error("League score update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


router.get("/league/leaderboard", async (req, res) => {
  try {
    await connectDB();

   // const limit = Math.max(1, Number(req.query.limit) || 3);
    const limit = 50;

    console.log({limit}, "dgdgdfgddg");
    

    const leaderboard = await LeagueProgress.aggregate([
      // Join user data
      {
        $lookup: {
          from: "users",
          localField: "playerId",
          foreignField: "playerId",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Sort players by score DESC
      { $sort: { total_score: -1 } },

      // Group by league + level
      {
        $group: {
          _id: {
            league: "$league.name",
            level: "$league.level",
          },
          players: {
            $push: {
              playerId: "$playerId",
              score: "$total_score",
              username: { $ifNull: ["$user.username", "Unknown"] },
              avatar_index: { $ifNull: ["$user.avatar_index", 0] },
              frame_index: { $ifNull: ["$user.frame_index", 0] },
            },
          },
        },
      },

      // Take top N players per level
      {
        $project: {
          _id: 0,
          league: {
            name: "$_id.league",
            level: "$_id.level",
          },
          topPlayers: { $slice: ["$players", limit] },
        },
      },

      // Sort leagues properly: gold → diamond, level 1 → 3
      {
        $sort: {
          "league.name": 1,
          "league.level": 1,
        },
      },
    ]);

    return res.json({ leaderboard });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


router.get("/league/rank", async (req, res) => {
  try {
    await connectDB();

    const { playerId } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: "playerId is required" });
    }

    const result = await LeagueProgress.aggregate([
      { $match: { playerId } },

      // Join user to get username
      {
        $lookup: {
          from: "users",
          localField: "playerId",
          foreignField: "playerId",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 0,
          playerId: 1,
          score: "$total_score",
          username: { $ifNull: ["$user.username", "Unknown"] },
          avatar_index: { $ifNull: ["$user.avatar_index", 0] },
          frame_index: { $ifNull: ["$user.frame_index", 0] },
          league: {
            name: "$league.name",
            level: "$league.level",
          },
        },
      },
    ]);

    if (!result.length) {
      return res.status(404).json({ error: "Player not found" });
    }

    return res.json(result[0]);
  } catch (err) {
    console.error("Player rank error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});






export default router;
