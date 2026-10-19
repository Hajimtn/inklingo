// Study-group leaderboard points. Shared by the server (server/groups.js adds them up) and the
// browser (the scoring guide on the Account page shows the same numbers).

export const GROUP_POINTS = {
  learnDay: 10, // all of the day's words opened
  streakStep: 2, // + per consecutive study day (max 5 steps)
  streakMax: 5,
  reviewCap: 20, // 1 point per word recalled correctly in Word Recall (checked the day after learning or later), per day
  matchCap: 30, // drawing-match points / 10, per day
  quizScale: 0.15, // quiz score (max 100 per question) * 0.15 -> 300 for a 20-question quiz
};
