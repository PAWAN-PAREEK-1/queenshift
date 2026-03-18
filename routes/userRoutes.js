import express from "express";
import User from "../models/user.js";
import crypto from "crypto";
import Level from "../models/level.js";
import { connectDB } from "../models/db.js";
import transaction from "../models/transaction.js";
import { LEAGUES } from "../leagueRules.js";
import LeagueProgress from "../models/LeagueProgress.js";
import SystemState from "../models/cronTime.js";
import fs from "fs";
import path from "path";
const router = express.Router();

export function calculateLeague(score) {
  const match = LEAGUES.find((l) => score >= l.min && score <= l.max);
  return match || { name: "bronze", level: 3 };
}

function getNextLeagueReset(lastRunAt) {
  const last = lastRunAt ? new Date(lastRunAt) : new Date();

  // clone date
  const next = new Date(last);

  // add 4 months in UTC
  next.setUTCMonth(next.getUTCMonth() + 4);
  next.setUTCHours(0, 0, 0, 0);

  const nowUtcMs = Date.now(); // UTC
  const remainingMs = Math.max(0, next.getTime() - nowUtcMs);

  return {
    nextRunAt: next, // Date object (UTC)
    remainingMs,
  };
}

// ----------------------
// Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    await connectDB();

    const { username, avatar_index, frame_index, email, playerId } = req.body;

    if (!username) {
      return res.status(400).json({ message: "username is required" });
    }

    // ✅ Only return played levels
    const formatPlayedLevels = (userLevels = {}) => {
      const formatted = {};

      for (const mode in userLevels) {
        const levelTimes = userLevels[mode]?.level_times || {};

        const levelsArray = Object.entries(levelTimes)
          .map(([level, time]) => ({
            levelNumber: Number(level),
            levelTime: time
          }))
          .sort((a, b) => a.levelNumber - b.levelNumber); // optional sort

        if (levelsArray.length > 0) {
          formatted[
            `${mode.charAt(0).toUpperCase() + mode.slice(1)}Levels`
          ] = levelsArray;
        }
      }

      return formatted;
    };

    // ============================
    // CASE 1: playerId + email
    // ============================
    if (playerId && email) {
      const existingUser = await User.findOne({ playerId }).lean();

      if (!existingUser) {
        return res.status(404).json({
          message: "PlayerId not found"
        });
      }

      // update email
      await User.updateOne(
        { playerId },
        { $set: { email } }
      );

      return res.status(200).json({
        message: "Email updated successfully",
        user: {
          _id: existingUser._id,
          username: existingUser.username,
          avatar_index: existingUser.avatar_index,
          frame_index: existingUser.frame_index,
          playerId: existingUser.playerId,
          levels: formatPlayedLevels(existingUser.levels)
        }
      });
    }

    // ============================
    // CASE 2: email only
    // ============================
    if (email && !playerId) {
      const existingEmail = await User.findOne({ email }).lean();

      // 👉 EXISTING USER
      if (existingEmail) {
        return res.status(200).json({
          message: "User already exists with this email",
          user: {
            _id: existingEmail._id,
            username: existingEmail.username,
            avatar_index: existingEmail.avatar_index,
            frame_index: existingEmail.frame_index,
            playerId: existingEmail.playerId,
            levels: formatPlayedLevels(existingEmail.levels)
          }
        });
      }

      // 👉 NEW USER
      const newPlayerId = crypto.randomBytes(16).toString("hex");

      const user = await User.create({
        username,
        avatar_index,
        frame_index,
        email,
        playerId: newPlayerId
      });

      return res.status(201).json({
        message: "Signup successful",
        user: {
          _id: user._id,
          username: user.username,
          avatar_index: user.avatar_index,
          frame_index: user.frame_index,
          playerId: user.playerId
          // ❌ no levels
        }
      });
    }

    // ============================
    // INVALID CASE
    // ============================
    return res.status(400).json({
      message: "Provide email OR (playerId + email)"
    });

  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message
    });
  }
});

// ----------------------
// Update Profile Route
// ----------------------
router.post("/update", async (req, res) => {
  try {
    await connectDB();
    const { playerId, username, avatar_index, frame_index } = req.body;
    const userId = playerId;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // find user
    const user = await User.findOne({ playerId: userId });
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
    if (typeof username !== "undefined" && user.username != username)
      user.username = username;
    if (typeof avatar_index !== "undefined") user.avatar_index = avatar_index;
    if (typeof frame_index !== "undefined") user.frame_index = frame_index;

    await user.save(); // no { new: true } needed

    res.json({
      message: "Profile Update",
      username: user.username,
      frame_index: user.frame_index,
      avatar_index: user.avatar_index,
      playerId: user.playerId,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/time", async (req, res) => {
   await connectDB();
  const system = await SystemState.findOne({ key: "league_reset" });

  const { nextRunAt, remainingMs } = getNextLeagueReset(system?.lastRunAt);

  const date = Date.now();
  return res.status(200).json({
    data: {
      date,
      nextRunAtUtc: nextRunAt.getTime(), // ✅ UTC
      // remainingMs, // ✅ absolute UTC diff
      // remaining: {
      //   days: Math.floor(remainingMs / (1000 * 60 * 60 * 24)),
      //   hours: Math.floor((remainingMs / (1000 * 60 * 60)) % 24),
      //   minutes: Math.floor((remainingMs / (1000 * 60)) % 60),
      //   seconds: Math.floor((remainingMs / 1000) % 60),
      // },
    },
  });
});

router.get("/get-user-data", async (req, res) => {
  const { email, playerId } = req.body;

  await connectDB();

  // Require at least one identifier
  if (!email && !playerId) {
    return res.status(400).json({
      message: "email or playerId is required"
    });
  }

  try {
    const projection = {
      username: 1,
      avatar_index: 1,
      frame_index: 1,
      playerId: 1,
      levels: 1
    };

    // Build query dynamically
    const query = {};
    if (email) query.email = email;
    if (playerId) query.playerId = playerId;

    const user = await User.findOne(query)
      .select(projection)
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const allLevels = await Level.find().lean();

    const modes = ["easy", "medium", "hard", "expert"];

    const formattedLevels = {};

    for (const mode of modes) {
      const modeLevels = allLevels.filter(l => l.mode === mode);

      formattedLevels[
        `${mode.charAt(0).toUpperCase() + mode.slice(1)}Levels`
      ] = modeLevels.map(level => ({
        levelNumber: level.level,
        levelTime:
          user.levels?.[mode]?.level_times?.get?.(String(level.level)) ||
          user.levels?.[mode]?.level_times?.[level.level] ||
          0
      }));
    }

    const response = {
      _id: user._id,
      username: user.username,
      avatar_index: user.avatar_index,
      frame_index: user.frame_index,
      playerId: user.playerId,
      levels: formattedLevels
    };

    return res.status(200).json({ user: response });

  } catch (err) {
    console.log("Error fetching user:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message
    });
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
      { upsert: true },
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

    const globalAverage = avgResult.length > 0 ? avgResult[0].averageTime : 0;

    // 8️⃣ Response
    return res.json({
      message: "Level completed and progress updated!",
      average: globalAverage,
    });
  } catch (err) {
    console.log("Error in /level-complete:", err);
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
      return res.status(400).json({
        message: "Level number is required and must be a valid number",
      });
    }
    const levelStr = String(level); // Map keys are stored as strings

    const leaderboardLimit = parseInt(limit, 10) || 10; // Default limit
    // Sort order: 1 for ascending (lowest time first), -1 for descending
    const sortOrder = order === "dec" ? -1 : 1;
    const sortDirection = { time_taken: sortOrder };

    // --- Aggregation Pipeline ---
    const pipeline = [
      // 1. Match users who completed the level
      {
        $match: {
          [`levels.${mode}.level_times.${levelStr}`]: { $gt: 0 },
        },
      },

      // 2. Extract level time
      {
        $addFields: {
          time_taken: `$levels.${mode}.level_times.${levelStr}`,
        },
      },

      // 3. Join LeagueProgress
      {
        $lookup: {
          from: "leagueprogresses", // 👈 adjust if needed
          localField: "playerId",
          foreignField: "playerId",
          as: "leagueData",
        },
      },

      // 4. Unwind league data
      {
        $unwind: {
          path: "$leagueData",
          preserveNullAndEmptyArrays: true,
        },
      },

      // 5. Sort leaderboard
      {
        $sort: sortDirection,
      },

      // 6. Limit
      {
        $limit: leaderboardLimit,
      },

      // 7. Final projection
      {
        $project: {
          _id: 0,
          username: 1,
          avatar_index: 1,
          frame_index: 1,
          time_taken: 1,

          // ✅ League info added
          league: {
            name: { $ifNull: ["$leagueData.league.name", "bronze"] },
            level: { $ifNull: ["$leagueData.league.level", 3] },
          },
        },
      },
    ];

    const leaderboard = await User.aggregate(pipeline);

    // --- Re-format the output for the client ---
    const formattedUsers = leaderboard.map((user) => ({
      username: user.username,
      avatar_index: user.avatar_index,
      frame_index: user.frame_index,
      // Renamed from average_time to level_time for clarity
      level_time: user.time_taken,
      league: {
        name: user.league?.name ?? null,
        level: user.league?.level ?? null,
      },
    }));

    res.json(formattedUsers);
  } catch (err) {
    console.log("Error in /leader:", err);
    res
      .status(500)
      .json({ error: "Server error during leaderboard retrieval" });
  }
});

router.post("/user-rank", async (req, res) => {
  try {
    await connectDB();
    console.error("📱 User-Agent:", req.headers["user-agent"]);
    console.error("🌐 Origin:", req.headers.origin);
    console.error("🧾 Query:", req.query);
    const { playerId, mode, level } = req.body;

    // --- 1. Input Validation ---
    if (
      !playerId ||
      !mode ||
      level === undefined ||
      isNaN(parseInt(level, 10))
    ) {
      return res.status(400).json({
        message:
          "Missing required fields: playerId, mode, and a valid level number",
      });
    }

    const levelStr = String(level); // Map keys are stored as strings
    // Path for MongoDB Aggregation (CORRECT for your schema)
    const userLevelTimePath = `levels.${mode}.level_times.${levelStr}`;

    // --- 2. Find the current user's time ---
    const user = await User.findOne(
      { playerId },
      { [userLevelTimePath]: 1, username: 1 }, // Only fetch the required time and username
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
      console.error("data not found user rank hited ");
      return res.status(200).json({
        message: `data not found ${userTime} `,
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
    const rankAbove =
      betterUsersCount.length > 0 ? betterUsersCount[0].count : 0;
    const userRank = rankAbove + 1;

    // --- 4. Get total players who completed the level (Optional, but useful for context) ---
    const totalPlayers = await User.countDocuments({
      [userLevelTimePath]: { $gt: 0 },
    });
    console.error("user rank completed ", { playerId, mode, level });
    // --- 5. Return Response ---
    res.json({
      username: user.username,
      mode: mode,
      rank: userRank,
      time: userTime,
    });
  } catch (err) {
    console.log("Error in /user-rank:", err);
    res.status(500).json({ error: "Server error during rank retrieval" });
  }
});

router.post("/bulk-signup", async (req, res) => {
  try {
    await connectDB();
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        message: "users array is required",
      });
    }

    const operations = [];
    const skippedUsers = [];

    for (const user of users) {
      const { username, avatar_index, frame_index, email, playerId } = user;

      if (!username) {
        skippedUsers.push({
          user,
          reason: "Username missing",
        });
        continue;
      }

      // Build user document safely
      const userDoc = {
        username,
        avatar_index: avatar_index ?? 0,
        frame_index: frame_index ?? 0,
        playerId: playerId ?? crypto.randomBytes(16).toString("hex"),
      };

      // ONLY add email if provided
      if (email) {
        userDoc.email = email;
      }

      operations.push({
        insertOne: {
          document: userDoc,
        },
      });
    }

    if (operations.length === 0) {
      return res.status(400).json({
        message: "No valid users to insert",
        skippedUsers,
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
      skippedUsers,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/transaction", async (req, res) => {
  try {
    await connectDB();

    const { transactionId, productId } = req.body;
    const time = Date.now();

    if (!transactionId) {
      return res.status(400).json({
        message: "transactionId is required",
      });
    }

    const transactionData = await transaction.findOneAndUpdate(
      { transactionId }, // 🔍 check by transactionId
      {
        $set: {
          productId,
          time,
        },
      },
      {
        new: true, // return updated document
        upsert: true, // create if not exists
      },
    );

    res.status(200).json({
      message: "transaction created or updated successfully",
      data: transactionData,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

router.get("/get-transaction", async (req, res) => {
  try {
    await connectDB();
    const { transactionId } = req.query;
    console.log({ transactionId });

    const transactions = await transaction.findOne(
      { transactionId },
      { _id: 0, transactionId: 1, time: 1, productId: 1 },
    );
    console.log({ transactions });

    if (!transactions) {
      return res.status(404).json({
        message: "transaction not found",
      });
    }

    res.status(200).json(transactions);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/bulk-level-complete", async (req, res) => {
  try {
    await connectDB();

    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        message: "records array is required",
      });
    }

    // 🔒 Safety limit for Vercel
    // if (records.length > 300) {
    //   return res.status(413).json({
    //     message: "Max 300 records per request"
    //   });
    // }

    const playerIds = records.map((r) => r.playerId);

    // 1️⃣ Fetch all users in ONE query
    const users = await User.find({ playerId: { $in: playerIds } });
    const userMap = new Map(users.map((u) => [u.playerId, u]));

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
      progress.current_level = Math.max(progress.current_level, requestedLevel);

      const times = [...progress.level_times.values()];
      const totalTime = times.reduce((a, b) => a + b, 0);
      progress.average_time = totalTime / times.length;

      userOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              [`levels.${mode}`]: progress,
            },
          },
        },
      });

      // ---- Global Level Stats (grouped) ----
      const key = `${mode}_${requestedLevel}`;

      if (!levelOpsMap.has(key)) {
        levelOpsMap.set(key, {
          mode,
          level: requestedLevel,
          total_time: 0,
          attempts: 0,
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
              attempts: entry.attempts,
            },
            $setOnInsert: {
              mode: entry.mode,
              level: entry.level,
            },
          },
          upsert: true,
        },
      });
    }

    if (levelOps.length > 0) {
      await Level.bulkWrite(levelOps, { ordered: false });
    }

    return res.json({
      message: "Bulk level completion processed",
      processed: records.length,
      skippedCount: skipped.length,
      skipped,
    });
  } catch (err) {
    console.log("Bulk level error:", err);
    res.status(500).json({
      error: "Server error during bulk level completion",
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
    console.log("League score update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/league/leaderboard", async (req, res) => {
  console.error("in leader board   ");

  const startTime = Date.now();
  try {
    await connectDB();

    // const limit = Math.max(1, Number(req.query.limit) || 3);
    const limit = 50;

    console.log("📊 Aggregation started");

    console.error({ limit }, "dgdgdfgddg");
    console.error("🚀 /league/leaderboard called");
    console.error("📱 User-Agent:", req.headers["user-agent"]);
    console.error("🌐 Origin:", req.headers.origin);
    console.error("🧾 Query:", req.query);

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

      // Sort leagues properly: silver → diamond, level 1 → 3
      {
        $sort: {
          "league.name": 1,
          "league.level": 1,
        },
      },
    ]);

    console.error("✅ Aggregation finished");
    console.error("📦 Leaderboard count:", leaderboard?.length);

    // 5️⃣ Response time
    console.error("⏱ Response time:", Date.now() - startTime, "ms");

    return res.json({ leaderboard });
  } catch (err) {
    console.error("❌ Leaderboard error");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
    console.error("Name:", err.name);

    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
});

router.get("/league/rank", async (req, res) => {
  try {
    await connectDB();
    console.log("inside leque rank , ", req.body, req.query);

    const { playerId } = req.query;
    if (!playerId) {
      return res.status(400).json({ error: "playerId is required" });
    }

    //  const result = await LeagueProgress.aggregate([

    //       { $match: { playerId } },

    //       // Join user to get username

    //       {

    //         $lookup: {

    //           from: "users",

    //           localField: "playerId",

    //           foreignField: "playerId",

    //           as: "user",

    //         },

    //       },

    //       { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

    //       {

    //         $project: {

    //           _id: 0,

    //           playerId: 1,

    //           score: "$total_score",

    //           username: { $ifNull: ["$user.username", "Unknown"] },

    //           avatar_index: { $ifNull: ["$user.avatar_index", 0] },

    //           frame_index: { $ifNull: ["$user.frame_index", 0] },

    //           league: {

    //             name: "$league.name",

    //             level: "$league.level",

    //           },

    //         },

    //       },

    //     ]);

    const result = await LeagueProgress.aggregate([
      // 1. Rank all players by score

      {
        $setWindowFields: {
          sortBy: { total_score: -1 },

          output: {
            ranknumber: { $rank: {} }, // or $denseRank
          },
        },
      },

      // 2. Match requested player

      {
        $match: { playerId },
      },

      // 3. Join user data

      {
        $lookup: {
          from: "users",

          localField: "playerId",

          foreignField: "playerId",

          as: "user",
        },
      },

      {
        $unwind: {
          path: "$user",

          preserveNullAndEmptyArrays: true,
        },
      },

      // 4. Final response shape

      {
        $project: {
          _id: 0,

          playerId: 1,

          score: "$total_score",

          ranknumber: 1,

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

    console.log({ result });

    if (!result.length) {
      return res.status(404).json({ error: "Player not found" });
    }

    return res.json(result[0]);
  } catch (err) {
    console.log("Player rank error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/league/update", async (req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setUTCHours(4, 30, 0, 0); // 10 AM IST

    // Get players created/updated before cutoff
    const players = await LeagueProgress.find({
      $or: [{ createdAt: { $lt: cutoff } }, { updatedAt: { $lt: cutoff } }],
    });

    let updatedCount = 0;

    for (const player of players) {
      const score = player.score; // 🔴 change if your field name is different

      const leagueData = LEAGUES.find((l) => score >= l.min && score <= l.max);

      if (!leagueData) continue;

      // Update only if league actually changes
      if (
        player.league.name !== leagueData.name ||
        player.league.level !== leagueData.level
      ) {
        await LeagueProgress.updateOne(
          { _id: player._id },
          {
            $set: {
              "league.name": leagueData.name,
              "league.level": leagueData.level,
            },
          },
        );
        updatedCount++;
      }
    }

    res.json({
      success: true,
      updated: updatedCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/rankUpdate", async (req, res) => {
  try {
    const allowedLevels = ["easy", "medium", "hard", "expert"];
    const MULTIPLIER = 2;

    // 1️⃣ Fetch users (only what we need)
    const users = await User.find({}, { levels: 1 }).lean();

    let modifiedCount = 0;

    // 2️⃣ Process users one by one
    for (const user of users) {
      let userChanged = false;
      const newLevels = { ...user.levels };

      for (const levelName of allowedLevels) {
        const level = newLevels[levelName];
        if (!level) continue;

        const times = level.level_times || {};
        const timeKeys = Object.keys(times);

        // 🚫 Skip empty levels
        if (timeKeys.length === 0) continue;

        // 3️⃣ Multiply & force INTEGER
        let sum = 0;
        const updatedTimes = {};

        for (const key of timeKeys) {
          const newVal3 = Math.round(times[key] / 3.6);
          const newVal = Math.round(newVal3 * MULTIPLIER);
          updatedTimes[key] = newVal;
          sum += newVal;
        }

        // 4️⃣ Recalculate average_time (INTEGER)
        const avg = Math.round(sum / timeKeys.length);

        newLevels[levelName] = {
          ...level,
          level_times: updatedTimes,
          average_time: avg,
        };

        userChanged = true;
      }

      // 5️⃣ Update only if something changed
      if (userChanged) {
        await User.updateOne(
          { _id: user._id },
          { $set: { levels: newLevels } },
        );
        modifiedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: "Rank update completed safely (JS calculated)",
      modifiedDocuments: modifiedCount,
    });
  } catch (error) {
    console.error("Rank update error:", error);
    return res.status(500).json({
      success: false,
      message: "Rank update failed",
      error: error.message,
    });
  }
});

// routes/leagueReset.js
router.post("/league/reset", async (req, res) => {
  try {
    await connectDB();

    await LeagueProgress.updateMany(
      {},
      {
        $set: {
          total_score: 0,
          league: {
            name: "Bronze",
            level: 3,
          },
        },
      },
    );

    await SystemState.updateOne(
      { key: "league_reset" },
      { lastRunAt: new Date() },
      { upsert: true },
    );

    return res.json({
      message: "✅ League reset completed",
    });
  } catch (err) {
    console.error("❌ League reset error:", err);
    return res.status(500).json({ error: "Reset failed" });
  }
});

router.get("/admin/export-db", async (req, res) => {
  try {
    await connectDB();

    const [users, leagueprogresses, levels, transactions] = await Promise.all([
      User.find({}).lean(),
      LeagueProgress.find({}).lean(),
      Level.find({}).lean(),
      transaction.find({}).lean(),
    ]);

    // ✅ Save in project root
    const exportDir = path.join(process.cwd(), "db-export");

    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(exportDir, "users.json"),
      JSON.stringify(users, null, 2),
    );

    fs.writeFileSync(
      path.join(exportDir, "leagueprogresses.json"),
      JSON.stringify(leagueprogresses, null, 2),
    );

    fs.writeFileSync(
      path.join(exportDir, "levels.json"),
      JSON.stringify(levels, null, 2),
    );

    fs.writeFileSync(
      path.join(exportDir, "transactions.json"),
      JSON.stringify(transactions, null, 2),
    );

    return res.json({
      message: "✅ Database exported successfully",
      path: exportDir,
      files: [
        "users.json",
        "leagueprogresses.json",
        "levels.json",
        "transactions.json",
      ],
    });
  } catch (err) {
    console.error("Export error:", err);
    return res.status(500).json({ error: "Export failed" });
  }
});

router.post("/admin/import-db", async (req, res) => {
  try {
    // 👇 connect explicitly to tmpdb
    await connectDB("tmpdb");

    const importDir = path.join(process.cwd(), "db-export");

    const files = {
      users: "users.json",
      leagueprogresses: "leagueprogresses.json",
      levels: "levels.json",
      transactions: "transactions.json",
    };

    // 1️⃣ Check files exist
    for (const file of Object.values(files)) {
      const filePath = path.join(importDir, file);
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({
          error: `Missing file: ${file}. Run export first.`,
        });
      }
    }

    // 2️⃣ Read JSON files
    const users = JSON.parse(
      fs.readFileSync(path.join(importDir, files.users), "utf8"),
    );
    const leagueprogresses = JSON.parse(
      fs.readFileSync(path.join(importDir, files.leagueprogresses), "utf8"),
    );
    const levels = JSON.parse(
      fs.readFileSync(path.join(importDir, files.levels), "utf8"),
    );
    const transactions = JSON.parse(
      fs.readFileSync(path.join(importDir, files.transactions), "utf8"),
    );

    // 3️⃣ DELETE existing documents (collections auto-exist)
    await Promise.all([
      User.deleteMany({}),
      LeagueProgress.deleteMany({}),
      Level.deleteMany({}),
      transaction.deleteMany({}),
    ]);

    // 4️⃣ INSERT fresh data (do not stop on errors)
    await Promise.all([
      users.length && User.insertMany(users, { ordered: false }),
      leagueprogresses.length &&
        LeagueProgress.insertMany(leagueprogresses, { ordered: false }),
      levels.length && Level.insertMany(levels, { ordered: false }),
      transactions.length &&
        transaction.insertMany(transactions, { ordered: false }),
    ]);

    // 5️⃣ Verify counts
    const counts = {
      users: await User.countDocuments(),
      leagueprogresses: await LeagueProgress.countDocuments(),
      levels: await Level.countDocuments(),
      transactions: await transaction.countDocuments(),
    };

    return res.json({
      message: "✅ tmpdb fully replaced from JSON files",
      counts,
    });
  } catch (err) {
    console.error("❌ Import error:", err);
    return res.status(500).json({
      error: "Import failed",
      message: err.message,
    });
  }
});
export default router;
