"use strict";

// Node requirements
const js = require("jservice-node");
const removeAccents = require("remove-accents");
const numberToWords = require("number-to-words");
const wordsToNumbers = require("words-to-numbers");
const ip = require("ip");
const Sentencer = require("sentencer");
const grawlix = require("grawlix");
grawlix.loadPlugin("grawlix-racism", {
  style: false
});

// Setting up connection to MongoDB via mongoose
let mongoose = require("mongoose");
mongoose.Promise = global.Promise;
mongoose.connect(
  "mongodb://iredlon:zorklantern02139@ds253804.mlab.com:53804/heroku_s6pk3wn4", {
    useNewUrlParser: true
  }
);
mongoose.set("useFindAndModify", false);

// Mongoose schema for saving each leader's information to the DB
let leaderSchema = new mongoose.Schema({
  position: Number,
  nickname: String,
  score: Number
}, {
  // Forces new leaders to be stored in the leaderboard collection
  collection: "leaderboard"
});
let Leader = mongoose.model("Leader", leaderSchema);

// Setup express server
const express = require("express");
const app = express();
app.disable("etag");

const path = require("path");
const server = require("http").createServer(app);
const io = require("socket.io")(server);

// Opens server on either localhost:5000 or host port
const PORT = process.env.PORT || 5000;
server.listen(PORT);

// Direct static file route to client folder
app.use(express.static(path.join(__dirname, "client")));

process.on("uncaughtException", err => {
  console.log(err);
});

// Debug tools
let finalJeopartyDebug = false;

// Each game that is occuring on the server simultaneously is given a
// session object with which to operate from. Throughout this script,
// game variables are referenced like: sessions[socket.sessionId].whatever
// so that multiple games can occur at once and the server can access the
// correct variables for each independent game
class session {
  constructor() {
    this.audioAllowed = false;
    this.gameActive = false;
    this.disconnectedPlayers = {};
    this.players = {};
    this.finalJeopartyPlayers = {};
    this.boardController;
    this.lastClueRequest;
    this.playersAnswered = [];
    this.buzzersReady = false;
    this.answerReady = false;
    this.buzzWinnerId;
    this.doubleJeoparty = false;
    this.doubleJeopartySetup = false;
    this.finalJeoparty = false;
    this.finalJeopartySetup = false;
    this.remainingClueIds = [
      "category-1-price-1",
      "category-1-price-2",
      "category-1-price-3",
      "category-1-price-4",
      "category-1-price-5",
      "category-2-price-1",
      "category-2-price-2",
      "category-2-price-3",
      "category-2-price-4",
      "category-2-price-5",
      "category-3-price-1",
      "category-3-price-2",
      "category-3-price-3",
      "category-3-price-4",
      "category-3-price-5",
      "category-4-price-1",
      "category-4-price-2",
      "category-4-price-3",
      "category-4-price-4",
      "category-4-price-5",
      "category-5-price-1",
      "category-5-price-2",
      "category-5-price-3",
      "category-5-price-4",
      "category-5-price-5",
      "category-6-price-1",
      "category-6-price-2",
      "category-6-price-3",
      "category-6-price-4",
      "category-6-price-5"
    ];
    this.usedClueIds = [];
    this.usedClueArray = {
      "category-1": [],
      "category-2": [],
      "category-3": [],
      "category-4": [],
      "category-5": [],
      "category-6": []
    };

    // Gamestates
    this.requesting = false;
    this.answering = false;

    // Game data
    this.usedCategoryIds = [];
    this.categoryNames = [];
    this.categoryDates = [];
    this.clues = {};
    this.dailyDoublesSet = false;
    this.dailyDoubleIds = [];
    this.finalJeopartyClue = undefined;

    // Timeouts
    this.noBuzzTimeout;
  }
}

// Stores all game sessions currently going on
let sessions = {};

// Socket logic
io.on("connection", function(socket) {

  socket.emit("connect_device");

  socket.on("set_host_socket", function() {
    // Searches for a new session ID that isn't already in use
    let sessionId;
    while (true) {
      sessionId = Sentencer.make("{{ noun }}").toUpperCase();

      if (!sessions[sessionId] && sessionId.length <= 5) {
        break;
      }
    }

    sessions[sessionId] = new session();
    sessions[sessionId].sessionId = sessionId;
    socket.sessionId = sessionId;

    socket.isHost = true;

    // Places the socket in a game room with the same name as the session ID
    socket.join(sessionId);

    socket.emit("update_session_id_text", sessionId);

    let leadersObject = {
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
      7: [],
      8: [],
      9: [],
      10: []
    }

    Leader.find({}, function(err, leaders) {
      leaders.forEach(function(leader) {
        // Grawlix filters racist profanity from nicknames displayed on the
        // leaderboard
        leadersObject[leader.position] = [grawlix(leader.nickname), leader.score];
      });
    }).then(() => {
      socket.emit("update_leaderboard", leadersObject);
    });

    generateCategories(socket);

    if (!sessions[sessionId].dailyDoublesSet) {
      sessions[sessionId].dailyDoublesSet = true;
      setDailyDoubleIds(socket);
    }
  });

  socket.on("audio_allowed", function() {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].audioAllowed = true;
    }
  });

  socket.on("join_session", function(requestedSessionId, cookie) {
    let sessionId = requestedSessionId.replace(/ /g, "");

    if (sessions[sessionId]) {
      socket.sessionId = sessionId;
      socket.cookie = cookie;
      socket.isHost = false;

      socket.join(sessionId);

      socket.emit(
        "join_session_success",
        // True if this player was previously disconnected from this session, else returns false
        Object.keys(sessions[socket.sessionId].disconnectedPlayers).includes(
          socket.cookie
        ),
        sessionId
      );
    } else {
      socket.emit("join_session_failure", sessionId);
    }
  });

  socket.on("join_game", function(nickname, signature) {
    if (sessions[socket.sessionId]) {
      let player = new Object();
      player.id = socket.id;
      player.nickname = nickname;
      player.signature = signature;
      player.score = 0;
      player.wager = 0;
      player.maxWager = 0;

      // Final jeoparty variables
      player.answer = "";
      player.correct = false;

      sessions[socket.sessionId].players[socket.id] = player;

      // Makes the first player to join the first board controller
      if (Object.keys(sessions[socket.sessionId].players).length == 1) {
        sessions[socket.sessionId].boardController = socket.id;
      }

      io.in(socket.sessionId).emit(
        "update_players_connected",
        nickname,
        Object.keys(sessions[socket.sessionId].players).length,
        true
      );

      io.in(socket.sessionId).emit(
        "update_players",
        sessions[socket.sessionId].players
      );

      socket.emit(
        "join_success",
        sessions[socket.sessionId].boardController,
        sessions[socket.sessionId].gameActive,
        sessions[socket.sessionId].categoryNames,
        sessions[socket.sessionId].categoryDates
      );
    }
  });

  socket.on("rejoin_game", function() {
    if (sessions[socket.sessionId]) {
      // This can only get called if this player object was inside of the
      // disconnectedPlayers object so this can't be a null reference
      let player = new Object();

      let playerData = sessions[socket.sessionId].disconnectedPlayers[socket.cookie];

      player.id = playerData[0];
      player.nickname = playerData[1];
      player.signature = playerData[2];
      player.score = playerData[3];
      player.wager = playerData[4];
      player.maxWager = playerData[5];

      // Final jeoparty variables
      player.answer = playerData[6];
      player.correct = playerData[7];

      // Adds the disconnected player back to the session object
      sessions[socket.sessionId].players[socket.id] = player;
      sessions[socket.sessionId].players[socket.id].id = socket.id;
      delete sessions[socket.sessionId].disconnectedPlayers[
        socket.cookie
      ];

      socket.emit(
        "join_success",
        sessions[socket.sessionId].boardController,
        sessions[socket.sessionId].gameActive,
        sessions[socket.sessionId].categoryNames,
        sessions[socket.sessionId].categoryDates
      );

      io.in(socket.sessionId).emit(
        "update_players",
        sessions[socket.sessionId].players
      );

      io.in(socket.sessionId).emit(
        "update_players_connected",
        playerData[1],
        Object.keys(sessions[socket.sessionId].players).length,
        true
      );
    }
  });

  socket.on("start_game", function() {
    if (sessions[socket.sessionId]) {
      // Audio needs to be allowed for the text to speech to work which is
      // necessary to all of the game's timing
      if (sessions[socket.sessionId].audioAllowed) {
        sessions[socket.sessionId].gameActive = true;
        sessions[socket.sessionId].requesting = true;

        io.in(socket.sessionId).emit(
          "load_game",
          sessions[socket.sessionId].categoryNames,
          sessions[socket.sessionId].categoryDates,
          sessions[socket.sessionId].boardController,
          sessions[socket.sessionId].players[
            sessions[socket.sessionId].boardController
          ].nickname
        );
      } else {
        socket.emit("start_game_failure");
      }
    }
  });

  socket.on("request_clue", function(clueRequest) {
    if (sessions[socket.sessionId]) {
      if (sessions[socket.sessionId].remainingClueIds.includes(clueRequest)) {
        sessions[socket.sessionId].requesting = false;

        // Checks to see if this clue request is a daily double
        // There is one daily double on the first board and two on the second board

        if (
          (!sessions[socket.sessionId].doubleJeoparty &&
            clueRequest == sessions[socket.sessionId].dailyDoubleIds[0]) ||
          (sessions[socket.sessionId].doubleJeoparty &&
            (clueRequest == sessions[socket.sessionId].dailyDoubleIds[1] ||
              clueRequest == sessions[socket.sessionId].dailyDoubleIds[2]))
        ) {
          io.in(socket.sessionId).emit(
            "display_daily_double_panel",
            clueRequest,
            sessions[socket.sessionId].clues[clueRequest]["screen_question"],
            sessions[socket.sessionId].boardController,
            sessions[socket.sessionId].players[
              sessions[socket.sessionId].boardController
            ].nickname
          );
        } else {
          io.in(socket.sessionId).emit(
            "display_clue",
            clueRequest,
            sessions[socket.sessionId].clues[clueRequest]["screen_question"]
          );
        }

        sessions[socket.sessionId].remainingClueIds.splice(
          sessions[socket.sessionId].remainingClueIds.indexOf(clueRequest),
          1
        );
        sessions[socket.sessionId].usedClueIds.push(clueRequest);
        // Splits ("category-x-price-y"), to give:
        // sessions[socket.sessionId].usedClueArray["category-x"].push("price-y")
        sessions[socket.sessionId].usedClueArray[clueRequest.slice(0, 10)].push(
          clueRequest.slice(11)
        );

        sessions[socket.sessionId].lastClueRequest = clueRequest;
      }
    }
  });

  socket.on("request_daily_double_wager", function() {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].answering = true;

      io.in(socket.sessionId).emit(
        "get_daily_double_wager",
        sessions[socket.sessionId].clues[
          sessions[socket.sessionId].lastClueRequest
        ]["category"]["title"],
        sessions[socket.sessionId].players[
          sessions[socket.sessionId].boardController
        ],
        getMaxWager(
          sessions[socket.sessionId].players[
            sessions[socket.sessionId].boardController
          ].score, socket
        )
      );
    }
  });

  socket.on("wager_livefeed", function(wagerLivefeed) {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit("wager_livefeed", wagerLivefeed);
    }
  });

  socket.on("daily_double_wager", function(wager) {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].players[
        sessions[socket.sessionId].boardController
      ].wager = wager;

      io.in(socket.sessionId).emit(
        "display_daily_double_clue",
        sessions[socket.sessionId].clues[
          sessions[socket.sessionId].lastClueRequest
        ]["screen_question"]
      );
    }
  });

  socket.on("request_daily_double_answer", function() {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit(
        "get_daily_double_answer",
        sessions[socket.sessionId].players[
          sessions[socket.sessionId].boardController
        ]
      );
    }
  });

  socket.on("answer_livefeed", function(livefeed) {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit("answer_livefeed", livefeed);
    }
  });

  socket.on("submit_answer", function(answer, dailyDouble) {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].answering = false;

      let correct = evaluateAnswer(answer, socket);

      io.in(socket.sessionId).emit("answer_submitted", answer, correct);

      if (dailyDouble) {
        updateScore(socket.id, correct, 1, true, socket);

        startTransition();
      } else {
        if (sessions[socket.sessionId].answerReady) {
          sessions[socket.sessionId].answerReady = false;
          sessions[socket.sessionId].playersAnswered.push(socket.id);

          updateScore(
            socket.id,
            correct,
            sessions[socket.sessionId].lastClueRequest[
              sessions[socket.sessionId].lastClueRequest.length - 1
            ],
            false,
            socket
          );

          startTransition();
        }
      }
    }

    function startTransition() {
      let correct = evaluateAnswer(answer, socket);

      io.in(socket.sessionId).emit(
        "update_players",
        sessions[socket.sessionId].players
      );

      // Waits 5 seconds to transition to leave time for the host screen to
      // show if the answer was correct or not
      setTimeout(function() {
        if (socket.sessionId) {
          if (correct) {
            sessions[socket.sessionId].boardController = socket.id;

            transition();
          } else if (
            (sessions[socket.sessionId].playersAnswered.length ==
              Object.keys(sessions[socket.sessionId].players).length) ||
            dailyDouble
          ) {
            // This branch runs if all of the players in the game
            // have already attempted to answer

            io.in(socket.sessionId).emit(
              "display_correct_answer",
              sessions[socket.sessionId].clues[
                sessions[socket.sessionId].lastClueRequest
              ]["screen_answer"],
              false
            );

            setTimeout(function() {
              if (socket.sessionId) {
                transition();
              }
            }, 5000);
          } else {
            // This branch runs if there are still players in the game
            // who are able to answer
            io.in(socket.sessionId).emit(
              "buzzers_ready",
              sessions[socket.sessionId].playersAnswered
            );
            sessions[socket.sessionId].buzzersReady = true;

            sessions[socket.sessionId].noBuzzTimeout =  setTimeout(function() {
              // Gets called by a timeout in the host's client.js if nobody buzzes in
              if (sessions[socket.sessionId]) {
                sessions[socket.sessionId].buzzersReady = false;

                io.in(socket.sessionId).emit(
                  "display_correct_answer",
                  sessions[socket.sessionId].clues[
                    sessions[socket.sessionId].lastClueRequest
                  ]["screen_answer"],
                  true
                );
                setTimeout(function() {
                  if (socket.sessionId) {
                    io.in(socket.sessionId).emit("reveal_scores");
                    resetVariables(socket);

                    setTimeout(function() {
                      if (socket.sessionId) {
                        if (
                          sessions[socket.sessionId].doubleJeoparty &&
                          !sessions[socket.sessionId].doubleJeopartySetup
                        ) {
                          sessions[socket.sessionId].doubleJeopartySetup = true;
                          io.in(socket.sessionId).emit(
                            "setup_double_jeoparty",
                            sessions[socket.sessionId].categoryNames,
                            sessions[socket.sessionId].categoryDates
                          );
                        } else if (
                          sessions[socket.sessionId].finalJeoparty &&
                          !sessions[socket.sessionId].finalJeopartySetup
                        ) {
                          sessions[socket.sessionId].finalJeopartySetup = true;
                          io.in(socket.sessionId).emit(
                            "setup_final_jeoparty",
                            sessions[socket.sessionId].finalJeopartyClue
                          );
                        }
                        io.in(socket.sessionId).emit(
                          "reveal_board",
                          sessions[socket.sessionId].usedClueArray,
                          sessions[socket.sessionId].remainingClueIds,
                          sessions[socket.sessionId].boardController,
                          sessions[socket.sessionId].players[
                            sessions[socket.sessionId].boardController
                          ].nickname
                        );
                        sessions[socket.sessionId].requesting = true;
                      }
                    }, 5000);
                  }
                }, 5000);
              }
            }, 5000);
          }
        }
      }, 5000);
    }

    function transition() {
      // Waits 5 seconds to show the board screen again to allow 1 second
      // for the players to see their old scores, and 4 seconds for them
      // to see their new scores

      io.in(socket.sessionId).emit("reveal_scores");
      resetVariables(socket);

      setTimeout(function() {
        if (socket.sessionId) {
          // doubleJeoparty and finalJeoparty are each assigned in resetVariables
          // and are setup here if they haven't been already
          if (
            sessions[socket.sessionId].doubleJeoparty &&
            !sessions[socket.sessionId].doubleJeopartySetup
          ) {
            sessions[socket.sessionId].doubleJeopartySetup = true;
            io.in(socket.sessionId).emit(
              "setup_double_jeoparty",
              sessions[socket.sessionId].categoryNames,
              sessions[socket.sessionId].categoryDates
            );
          } else if (
            sessions[socket.sessionId].finalJeoparty &&
            !sessions[socket.sessionId].finalJeopartySetup
          ) {
            sessions[socket.sessionId].finalJeopartySetup = true;
            io.in(socket.sessionId).emit(
              "setup_final_jeoparty",
              sessions[socket.sessionId].finalJeopartyClue
            );
          }

          io.in(socket.sessionId).emit(
            "reveal_board",
            sessions[socket.sessionId].usedClueArray,
            sessions[socket.sessionId].remainingClueIds,
            sessions[socket.sessionId].boardController,
            sessions[socket.sessionId].players[
              sessions[socket.sessionId].boardController
            ].nickname
          );
          sessions[socket.sessionId].requesting = true;
        }
      }, 5000);
    }
  });

  socket.on("activate_buzzers", function() {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit(
        "buzzers_ready",
        sessions[socket.sessionId].playersAnswered
      );
      sessions[socket.sessionId].buzzersReady = true;

      sessions[socket.sessionId].noBuzzTimeout =  setTimeout(function() {
        // Gets called by a timeout in the host's client.js if nobody buzzes in
        if (sessions[socket.sessionId]) {
          sessions[socket.sessionId].buzzersReady = false;

          io.in(socket.sessionId).emit(
            "display_correct_answer",
            sessions[socket.sessionId].clues[
              sessions[socket.sessionId].lastClueRequest
            ]["screen_answer"],
            true
          );
          setTimeout(function() {
            if (socket.sessionId) {
              io.in(socket.sessionId).emit("reveal_scores");
              resetVariables(socket);

              setTimeout(function() {
                if (socket.sessionId) {
                  if (
                    sessions[socket.sessionId].doubleJeoparty &&
                    !sessions[socket.sessionId].doubleJeopartySetup
                  ) {
                    sessions[socket.sessionId].doubleJeopartySetup = true;
                    io.in(socket.sessionId).emit(
                      "setup_double_jeoparty",
                      sessions[socket.sessionId].categoryNames,
                      sessions[socket.sessionId].categoryDates
                    );
                  } else if (
                    sessions[socket.sessionId].finalJeoparty &&
                    !sessions[socket.sessionId].finalJeopartySetup
                  ) {
                    sessions[socket.sessionId].finalJeopartySetup = true;
                    io.in(socket.sessionId).emit(
                      "setup_final_jeoparty",
                      sessions[socket.sessionId].finalJeopartyClue
                    );
                  }
                  io.in(socket.sessionId).emit(
                    "reveal_board",
                    sessions[socket.sessionId].usedClueArray,
                    sessions[socket.sessionId].remainingClueIds,
                    sessions[socket.sessionId].boardController,
                    sessions[socket.sessionId].players[
                      sessions[socket.sessionId].boardController
                    ].nickname
                  );
                  sessions[socket.sessionId].requesting = true;
                }
              }, 5000);
            }
          }, 5000);
        }
      }, 5000);
    }
  });

  socket.on("buzz", function() {
    if (sessions[socket.sessionId]) {
      clearTimeout(sessions[socket.sessionId].noBuzzTimeout);

      if (sessions[socket.sessionId].buzzersReady) {
        sessions[socket.sessionId].buzzWinnerId = socket.id;
        sessions[socket.sessionId].buzzersReady = false;
        sessions[socket.sessionId].answerReady = true;

        // Leaves 250 ms for players to see whether they won the buzz or not
        setTimeout(function() {
          io.in(socket.sessionId).emit(
            "get_answer",
            sessions[socket.sessionId].players[
              sessions[socket.sessionId].buzzWinnerId
            ]
          );

          sessions[socket.sessionId].answering = true;
        }, 250);
      }
    }
  });

  socket.on("request_final_jeoparty_wager", function() {
    if (sessions[socket.sessionId]) {
      for (let id in sessions[socket.sessionId].players) {
        // Doesn't let any player who has less than or equal to 0 dollars
        // participate in final jeoparty
        if (sessions[socket.sessionId].players[id].score > 0) {
          sessions[socket.sessionId].players[id].maxWager = getMaxWager(
            sessions[socket.sessionId].players[id].score,
            socket
          );
          sessions[socket.sessionId].finalJeopartyPlayers[id] =
            sessions[socket.sessionId].players[id];
        }
      }

      if (Object.keys(sessions[socket.sessionId].finalJeopartyPlayers).length > 0) {
        io.in(socket.sessionId).emit(
          "get_final_jeoparty_wager",
          sessions[socket.sessionId].finalJeopartyPlayers
        );
      } else {
        io.in(socket.sessionId).emit("reset_game", true);
      }

      // Displays the final jeoparty clue after leaving 15 seconds for players to wager
      setTimeout(function() {
        if (socket.sessionId) {
          io.in(socket.sessionId).emit("display_final_jeoparty_clue");
        }
      }, 15000);
    }
  });

  socket.on("final_jeoparty_wager", function(wager) {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].finalJeopartyPlayers[socket.id].wager = wager;
    }
  });

  socket.on("request_final_jeoparty_answer", function() {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit("get_answer_final_jeoparty");

      // Displays each player's final jeoparty answer after giving 30 seconds
      // for them to answer
      setTimeout(function() {
        if (socket.sessionId) {
          io.in(socket.sessionId).emit(
            "display_final_jeoparty_answers",
            sessions[socket.sessionId].finalJeopartyPlayers
          );
        }
      }, 30000);
    }
  });

  socket.on("submit_final_jeoparty_answer", function(answer) {
    if (sessions[socket.sessionId]) {
      sessions[socket.sessionId].finalJeopartyPlayers[
        socket.id
      ].answer = answer;
      sessions[socket.sessionId].finalJeopartyPlayers[
        socket.id
      ].correct = evaluateAnswer(answer, socket);
      if (evaluateAnswer(answer, socket)) {
        sessions[socket.sessionId].finalJeopartyPlayers[socket.id].score +=
          sessions[socket.sessionId].finalJeopartyPlayers[socket.id].wager;
      } else {
        sessions[socket.sessionId].finalJeopartyPlayers[socket.id].score -=
          sessions[socket.sessionId].finalJeopartyPlayers[socket.id].wager;
      }

      updateLeaderboard(sessions[socket.sessionId].finalJeopartyPlayers[socket.id]);
    }
  });

  socket.on("request_players", function() {
    if (sessions[socket.sessionId]) {
      io.in(socket.sessionId).emit(
        "update_players",
        sessions[socket.sessionId].players
      );
    }
  });

  socket.on("reset_all", function() {
    io.in(socket.sessionId).emit("reset_game", true);
  });

  socket.on("disconnecting", function() {
    if (socket.sessionId) {
      if (sessions[socket.sessionId]) {
        if (Object.keys(sessions[socket.sessionId].players).length == 1) {
          io.in(socket.sessionId).emit("reset_game", true);
          delete sessions[socket.sessionId];
        } else {
          if (socket.isHost) {
            delete sessions[socket.sessionId];
            return;
          }

          try {
            // This gives players an opportunity to rejoin the game if they
            // did not intend to disconnect from the game by identifying them
            // in the disconnectedPlayers object by their "cookie", a string
            // of numbers that was assigned in joinSession() in client.js
            let player = sessions[socket.sessionId].players[socket.id];

            sessions[socket.sessionId].disconnectedPlayers[
              socket.cookie
            ] = [player.id, player.nickname, player.signature, player.score, player.wager, player.maxWager, player.answer, player.correct];

          } catch (e) {
            // If player hasn't joined the game yet and wouldn't have a position
            // inside of the players object
          }

          io.in(socket.sessionId).emit(
            "update_players_connected",
            sessions[socket.sessionId].players[socket.id].nickname,
            (Object.keys(sessions[socket.sessionId].players).length - 1),
            false
          );

          socket.leave(socket.sessionId);

          try {
            delete sessions[socket.sessionId].players[socket.id];
          } catch (e) {
            // If player hasn't joined the game yet and wouldn't have a position
            // inside of the players object
          }

          if (sessions[socket.sessionId].finalJeoparty) {
            try {
              delete sessions[socket.sessionId].finalJeopartyPlayers[socket.id];
            } catch (e) {
              // If player was not added to finalJeopartyPlayers because
              // they didn't have enough money
            }
          }

          io.in(socket.sessionId).emit(
            "update_players",
            sessions[socket.sessionId].players
          );

          if (sessions[socket.sessionId].gameActive) {
            if (sessions[socket.sessionId].boardController == socket.id) {
              // If the disconnected player was the board controller, the role of
              // board controller is moved to another player
              sessions[socket.sessionId].boardController = Object.keys(
                sessions[socket.sessionId].players
              )[0];
              io.in(socket.sessionId).emit(
                "change_board_controller",
                sessions[socket.sessionId].boardController,
                sessions[socket.sessionId].players[
                  sessions[socket.sessionId].boardController
                ].nickname
              );
            }

            if (
              sessions[socket.sessionId].answering &&
              (sessions[socket.sessionId].boardController == socket.id ||
                sessions[socket.sessionId].buzzWinnerId == socket.id)
            ) {
              // If the disconnected player was in the middle of answering,
              // the host cuts to displaying the correct answer and the game moves on
              io.in(socket.sessionId).emit(
                "display_correct_answer",
                sessions[socket.sessionId].clues[
                  sessions[socket.sessionId].lastClueRequest
                ]["screen_answer"],
                false
              );

              setTimeout(function() {
                if (socket.sessionId) {
                  io.in(socket.sessionId).emit("reveal_scores");

                  setTimeout(function() {
                    if (socket.sessionId) {
                      io.in(socket.sessionId).emit(
                        "reveal_board",
                        sessions[socket.sessionId].usedClueArray,
                        sessions[socket.sessionId].remainingClueIds,
                        sessions[socket.sessionId].boardController,
                        sessions[socket.sessionId].players[
                          sessions[socket.sessionId].boardController
                        ].nickname
                      );
                      sessions[socket.sessionId].requesting = true;
                    }
                  }, 5000);
                }
              }, 5000);
            }
            // Game isn't active yet
          } else {
            if (sessions[socket.sessionId].boardController == socket.id) {
              sessions[socket.sessionId].boardController = Object.keys(
                sessions[socket.sessionId].players
              )[0];

              io.in(socket.sessionId).emit("change_start_game_player", sessions[socket.sessionId].boardController);
            }
          }
        }
      }
    }
  });
});

// Game logic

function getStartingIndex(cluesCount) {
  /*
  Returns a multiple of 5 in the range of cluesCount (but not including cluesCount)

  5 -> 0
  15 -> 0, 5, 10
  25 -> 0, 5, 10, 15, 20
   */

  return Math.round((Math.random() * (cluesCount - 5)) / 5) * 5;
}

function generateCategories(socket) {
  /*
  Gets 6 random categories from the jservice.io question database
   */

  let categoriesLoaded = 0;

  if (sessions[socket.sessionId]) {
    let checkInterval = setInterval(function() {
      let categoryId = Math.floor(Math.random() * 18418) + 1;

      let options = {
        category: categoryId
      };

      js.clues(options, function(error, response, json) {
        // Each category has a number of clues that is a multiple of 5 because
        // each time the category is used on the show there are 5 questions so
        // we find one of these sets of 5 by choosing an appropriate starting index
        let startingIndex = getStartingIndex(json[0]["category"]["clues_count"]);
        if (
          !error &&
          response.statusCode == 200 &&
          !sessions[socket.sessionId].usedCategoryIds.includes(categoryId) &&
          approveCategory(json, startingIndex)
        ) {
          sessions[socket.sessionId].usedCategoryIds.push(categoryId);
          loadCategory(json, startingIndex, socket);
          categoriesLoaded++;
        }
      });

      // Breaks the interval when 6 approved categories have been chosen
      if (categoriesLoaded > 7 || !sessions[socket.sessionId]) {
        clearInterval(checkInterval);
      }
    }, 100);
  }
}

function approveCategory(category, startingIndex) {
  /*
  Returns true if all category questions meet criteria, else returns false
   */

  for (let i = startingIndex; i < startingIndex + 5; i++) {
    let rawQuestion = formatRaw(category[i]["question"]);
    let rawCategory = formatRaw(category[i]["category"]["title"]);

    if (
      category[i]["invalid_count"] != null ||
      rawQuestion.length == 0 ||
      // Prevents any category that requires media besides text for its clues
      // from being used
      rawQuestion.includes("seenhere") ||
      rawQuestion.includes("heardhere") ||
      rawQuestion.includes("video") ||
      rawCategory.includes("logo") ||
      rawCategory.includes("video") ||
      rawQuestion.length > 200
    ) {
      return false;
    }
  }
  return true;
}

function loadCategory(category, startingIndex, socket) {
  /*
  Adds category and its relevant data to the appropriate global variables
  for use throughout the game
   */

  let indices = [];

  // This function could loop through indices 0 through 5 but we may actually
  // looping through indices 10 through 15 or something, so this list ensures
  // we loop through the correct indices
  for (let j = startingIndex; j < startingIndex + 5; j++) {
    indices.push(j);
  }

  if (sessions[socket.sessionId].categoryNames.length < 6) {
    sessions[socket.sessionId].categoryNames.push(
      category[indices[0]]["category"]["title"]
    );
    sessions[socket.sessionId].categoryDates.push(
      category[indices[0]]["airdate"].slice(0, 4)
    );

    for (let i = 1; i < 6; i++) {
      // This string is an HTML div ID that looks like "category-x-price-y"
      let id =
        "category-" +
        sessions[socket.sessionId].categoryNames.length +
        "-price-" +
        i;

      sessions[socket.sessionId].clues[id] = category[indices[i - 1]];
      // Screen question is just the original question capitalized
      sessions[socket.sessionId].clues[id]["screen_question"] = sessions[
        socket.sessionId
      ].clues[id]["question"].toUpperCase();
      // Raw answer is used to evaluate a player's answer against,
      // the players never see it
      sessions[socket.sessionId].clues[id]["raw_answer"] = formatRaw(
        sessions[socket.sessionId].clues[id]["answer"]
      );
      // Screen answer is the text displayed to the players
      sessions[socket.sessionId].clues[id][
        "screen_answer"
      ] = formatScreenAnswer(sessions[socket.sessionId].clues[id]["answer"]);
    }
    // generateCategories() finds 7 categories instead of the board's usual 6
    // because the 7th category provides the final jeoparty clue
  } else if (sessions[socket.sessionId].finalJeopartyClue == undefined) {
    // Identical process as above but takes the hardest question in the category
    // TODO: Add a bell curve system similar to setDailyDoubleIds so that
    // the final jeoparty clue isn't always a $1000 question in its category
    sessions[socket.sessionId].finalJeopartyClue = category[indices[4]];
    sessions[socket.sessionId].finalJeopartyClue["screen_question"] = sessions[
      socket.sessionId
    ].finalJeopartyClue["question"].toUpperCase();
    sessions[socket.sessionId].finalJeopartyClue["raw_answer"] = formatRaw(
      sessions[socket.sessionId].finalJeopartyClue["answer"]
    );
    sessions[socket.sessionId].finalJeopartyClue[
      "screen_answer"
    ] = formatScreenAnswer(
      sessions[socket.sessionId].finalJeopartyClue["answer"]
    );
  }
}

function setDailyDoubleIds(socket) {
  /*
  Selects 3 random clue IDs to be daily doubles
   */

  sessions[socket.sessionId].dailyDoubleIds = [];

  let categoryNums = [1, 2, 3, 4, 5, 6];

  for (let i = 0; i < 3; i++) {
    // Changing categoryNums with each iteration stops the same
    // category number from having more than 1 daily double.
    // This isn't neccessarily how the game show does it, but it stops
    // one player from being able to capitalize on their knowledge in one category
    let index = Math.floor(Math.random() * categoryNums.length);
    let categoryNum = categoryNums[index];
    categoryNums.splice(index, 1);

    let priceNum;
    let rng = Math.random();

    // Simple bell curve structure for "weighted" randomization
    if (rng < 0.15) {
      priceNum = 3;
    } else if (rng > 0.85) {
      priceNum = 4;
    } else {
      priceNum = 5;
    }

    sessions[socket.sessionId].dailyDoubleIds.push(
      "category-" + categoryNum + "-price-" + priceNum
    );
  }
}

function formatRaw(original) {
  /*
  Removes formatting and punctuation from original, then returns it
   */

  let rawAnswer = original.toLowerCase();

  // Remove accents
  rawAnswer = removeAccents(rawAnswer);

  // Additional space so that replacing 'a ' always works
  // when 'a' is the last letter of original
  rawAnswer = rawAnswer + " ";

  // HTML tags
  rawAnswer = rawAnswer.replace(/<i>/g, "");
  rawAnswer = rawAnswer.replace("</i>", "");

  // Punctuation
  rawAnswer = rawAnswer.replace(/[.,\/#!$%\^&\*;:"'{}=\-_`~()]/g, " ");
  rawAnswer = rawAnswer.replace(/\s{2,}/g, " ");
  rawAnswer = rawAnswer.replace(String.fromCharCode(92), "");

  // Red words
  rawAnswer = rawAnswer.replace(/and /g, "");
  rawAnswer = rawAnswer.replace(/the /g, "");
  rawAnswer = rawAnswer.replace(/a /g, "");
  rawAnswer = rawAnswer.replace(/an /g, "");

  // Edge cases
  rawAnswer = rawAnswer.replace(/v /g, "");
  rawAnswer = rawAnswer.replace(/v. /g, "");
  rawAnswer = rawAnswer.replace(/vs /g, "");
  rawAnswer = rawAnswer.replace(/vs. /g, "");

  // Spacing
  rawAnswer = rawAnswer.replace(/ /g, "");

  return rawAnswer;
}

function formatScreenAnswer(original) {
  /*
  Removes formatting and certain punctuations from original, then returns it
   */

  // Uppercase everything
  let screenAnswer = original.toUpperCase();

  // Backslashes
  screenAnswer = screenAnswer.replace(String.fromCharCode(92), "");

  // HTML tags
  screenAnswer = screenAnswer.replace(/<I>/g, "");
  screenAnswer = screenAnswer.replace("</I>", "");

  // Quotation marks
  screenAnswer = screenAnswer.replace(/"/g, "");
  screenAnswer = screenAnswer.replace(/'/g, "");

  return screenAnswer;
}

function getMaxWager(score, socket) {
  /*
  Returns the highest value the player can wager in daily double/final jeoparty
   */

  let maxWager;

  // The maximum amount you can wager is the higher of your current score and
  // the highest amount of money available on the board currently

  if (sessions[socket.sessionId].doubleJeoparty) {
    if (score > 2000) {
      maxWager = score;
    } else {
      maxWager = 2000;
    }
  } else {
    if (score > 1000) {
      maxWager = score;
    } else {
      maxWager = 1000;
    }
  }

  return maxWager;
}

function evaluateAnswer(answer, socket) {
  /*
  Returns true if the answer is correct (or is relatively close to correct),
  else returns false
   */

  let correctAnswer;

  if (sessions[socket.sessionId].finalJeoparty) {
    correctAnswer = sessions[socket.sessionId].finalJeopartyClue["raw_answer"];
  } else {
    correctAnswer =
      sessions[socket.sessionId].clues[
        sessions[socket.sessionId].lastClueRequest
      ]["raw_answer"];
  }
  let playerAnswer = formatRaw(answer);

  let categoryName = formatRaw(
    sessions[socket.sessionId].clues[
      sessions[socket.sessionId].lastClueRequest
    ]["category"]["title"]
  );

  if (playerAnswer == correctAnswer) {
    return true;
  } else {
    // This check prevents players from trying to take advantage of a category like
    // "Men named Jack" by only answering with "Jack",
    // if they do this, they need to have the answer completely correct
    if (
      categoryName.includes(playerAnswer) ||
      answer.length <= 2
    ) {
      return false;
    } else {
      if (
        correctAnswer.includes(playerAnswer) ||
        playerAnswer.includes(correctAnswer)
      ) {
        return true;
      } else if (checkEdgeCases(playerAnswer, correctAnswer)) {
        return true;
      } else {
        if (isNaN(playerAnswer)) {
          if (
            wordsToNumbers
            .wordsToNumbers(correctAnswer)
            .includes(playerAnswer) ||
            wordsToNumbers.wordsToNumbers(playerAnswer).includes(correctAnswer)
          ) {
            return true;
          } else {
            return false;
          }
        } else {
          if (correctAnswer.includes(numberToWords.toWords(playerAnswer))) {
            return true;
          } else {
            return false;
          }
        }
      }
    }
  }
}

function checkEdgeCases(playerAnswer, correctAnswer) {
  let jfkList = ["jfk", "johnfkennedy", "kennedy", "johnfitzgeraldkennedy"];
  if (jfkList.includes(playerAnswer) && jfkList.includes(correctAnswer)) {
    return true;
  }

  let fdrList = ["fdr", "franklindroosevelt", "roosevelt", "franklindelanoroosevelt"];
  if (fdrList.includes(playerAnswer) && fdrList.includes(correctAnswer)) {
    return true;
  }

  let lbjList = ["lbj", "lyndonbjohnson", "johnson", "lyndonbainesjohnson"];
  if (lbjList.includes(playerAnswer) && lbjList.includes(correctAnswer)) {
    return true;
  }

  return false;
}

function updateScore(id, correct, multiplier, dailyDouble, socket) {
  // Base holds the number that will be multiplied given what price bracket
  // the clue was in
  let base;

  if (dailyDouble) {
    base = sessions[socket.sessionId].players[id].wager;
  } else if (sessions[socket.sessionId].doubleJeoparty) {
    base = 400;
  } else {
    base = 200;
  }

  if (correct) {
    sessions[socket.sessionId].players[id].score += base * multiplier;
  } else {
    sessions[socket.sessionId].players[id].score -= base * multiplier;
  }
}

function updateLeaderboard(player) {
  Leader.find({}, function(err, leaders) {

    let i = 0;

    checkLeaders();

    function checkLeaders() {
      let leader = leaders[i];

      if (player.score > leader.score) {
        let j = i + 1;

        pushLeader();

        function pushLeader() {

          Leader.findOneAndUpdate({
              position: j + 1
            }, {
              nickname: leaders[j - 1].nickname,
              score: leaders[j - 1].score
            },
            function(err) {
              if (err) throw err;
            }
          ).then(() => {
            j++;

            if (j <= 10) {
              pushLeader();
            }
          });
        }

        Leader.findOneAndUpdate({
            position: i + 1
          }, {
            nickname: player.nickname,
            score: player.score
          },
          function(err) {
            if (err) throw err;
          }
        );
      } else {
        i++;

        if (i <= 9) {
          checkLeaders();
        }
      }
    }
  });
}

function resetVariables(socket) {
  /*
  Resets variables that change between rounds
   */

  sessions[socket.sessionId].playersAnswered = [];

  // Resets board variables when single jeoparty board is empty
  if (
    sessions[socket.sessionId].usedClueIds.length == 30 &&
    !sessions[socket.sessionId].doubleJeoparty
  ) {
    sessions[socket.sessionId].doubleJeoparty = true;

    sessions[socket.sessionId].remainingClueIds = [
      "category-1-price-1",
      "category-1-price-2",
      "category-1-price-3",
      "category-1-price-4",
      "category-1-price-5",
      "category-2-price-1",
      "category-2-price-2",
      "category-2-price-3",
      "category-2-price-4",
      "category-2-price-5",
      "category-3-price-1",
      "category-3-price-2",
      "category-3-price-3",
      "category-3-price-4",
      "category-3-price-5",
      "category-4-price-1",
      "category-4-price-2",
      "category-4-price-3",
      "category-4-price-4",
      "category-4-price-5",
      "category-5-price-1",
      "category-5-price-2",
      "category-5-price-3",
      "category-5-price-4",
      "category-5-price-5",
      "category-6-price-1",
      "category-6-price-2",
      "category-6-price-3",
      "category-6-price-4",
      "category-6-price-5"
    ];
    sessions[socket.sessionId].usedClueIds = [];
    sessions[socket.sessionId].usedClueArray = {
      "category-1": [],
      "category-2": [],
      "category-3": [],
      "category-4": [],
      "category-5": [],
      "category-6": []
    };

    sessions[socket.sessionId].categoryNames = [];
    sessions[socket.sessionId].categoryDates = [];
    sessions[socket.sessionId].clues = {};

    // Gives board control to the player in last place to begin
    // double jeoparty
    let clone = JSON.parse(JSON.stringify(sessions[socket.sessionId].players));
    let keys = Object.keys(clone);
    keys.sort(function(a, b) {
      return clone[a].score - clone[b].score;
    });
    sessions[socket.sessionId].boardController = keys[0];

    // Generates new categories for double jeoparty
    generateCategories(socket);
  }
  // If all double jeoparty clues are used, start final jeoparty
  else if (
    (sessions[socket.sessionId].usedClueIds.length == 30 &&
      sessions[socket.sessionId].doubleJeoparty) ||
    finalJeopartyDebug
  ) {
    sessions[socket.sessionId].finalJeoparty = true;
    sessions[socket.sessionId].doubleJeoparty = false;
  }
}
