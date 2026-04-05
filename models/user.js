import mongoose from "mongoose";

const levelProgressSchema = new mongoose.Schema({
  current_level: { type: Number, default: 0 },
  // Stores total time taken for each level
  level_times: {
    type: Map,
    of: Number, // { "1": 23, "2": 30 ... seconds }
    default: {},
  },
  average_time: { type: Number, default: 0 },
});

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    avatar_index: { type: Number, default: 0 },
    frame_index: { type: Number, default: 0 },

    levels: {
      easy: { type: levelProgressSchema, default: () => ({}) },
      medium: { type: levelProgressSchema, default: () => ({}) },
      hard: { type: levelProgressSchema, default: () => ({}) },
      expert: { type: levelProgressSchema, default: () => ({}) },
      dailyquest: { type: levelProgressSchema, default: () => ({}) },
      weeklychallenge: { type: levelProgressSchema, default: () => ({}) },
      thetower: { type: levelProgressSchema, default: () => ({}) },
      timerush: { type: levelProgressSchema, default: () => ({}) },
      twistermode: { type: levelProgressSchema, default: () => ({}) },
    },
    playerId: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deleteScheduledAt: {
      type: Date,
      default: null,
    },
     coinValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    hintValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    // 📅 Activity Tracking
    lastDailyQuestDate: {
      type: String,
      default: null,
    },
    lastNewEventDate: {
      type: String,
      default: null,
    },

  },
  {
    timestamps: true, // ✅ THIS ADDS createdAt & updatedAt
  },
);

const excludeDeleted = function () {
  const filter = this.getFilter?.();

  if (!filter || filter.isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
};

userSchema.pre('find', excludeDeleted);
userSchema.pre('findOne', excludeDeleted);
userSchema.pre('findOneAndUpdate', excludeDeleted);
userSchema.pre('countDocuments', excludeDeleted);
userSchema.pre('updateOne', excludeDeleted);
userSchema.pre('updateMany', excludeDeleted);
userSchema.pre('exists', excludeDeleted);

userSchema.pre('aggregate', function () {
  const pipeline = this.pipeline();

  if (pipeline.length === 0) {
    pipeline.unshift({ $match: { isDeleted: { $ne: true } } });
    return;
  }

  const firstStage = pipeline[0];

  if (firstStage.$match) {
    if (firstStage.$match.isDeleted === undefined) {
      firstStage.$match.isDeleted = { $ne: true };
    }
  } else {
    pipeline.unshift({ $match: { isDeleted: { $ne: true } } });
  }
});

export default mongoose.model("User", userSchema);
