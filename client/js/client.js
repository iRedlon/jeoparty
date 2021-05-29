"use strict";

let waitingToJoin = false;
let joined = false;
let currentScreenId;
let isHost;
let audioAllowed = false;
let audioFiles;
let players;
let overflowNicknames;
let lastCategoryWrapperId;
let lastCategoryId;
let lastPriceWrapperId;
let lastPriceId;
let buzzWinner;
let usedClues;
let currentScreenQuestion;
let doubleJeoparty = false;
let maxWager;
let dailyDouble = false;
let finalJeoparty = false;
let finalJeopartyClue;
let finalJeopartyPlayer;

// Timeout/interval handlers
let questionInterval;
let answerLivefeedInterval;
let wagerLivefeedInterval;
let scrapeAnswerTimeout;
let scrapeWagerTimeout;

let socket = io();

// Socket logic

socket.on("connect_device", function() {
  // Checks to see if this is a mobile device
  if (/Mobi/.test(navigator.userAgent)) {
    adjustMobileStyle();
    // Makes the controller part of index.html visible, leaving the host part
    // invisible
    document.getElementById("controller").className = "";

    currentScreenId = "join-session-screen";
    isHost = false;
  } else {
    socket.emit("set_host_socket");
    // Makes the host part of index.html visible, leaving the controller part
    // invisible
    document.getElementById("host").className = "";

    currentScreenId = "h-landing-screen";
    isHost = true;
  }
});

socket.on("update_session_id_text", function(sessionId) {
  document.getElementById("session-id-text").innerHTML = sessionId;
});

socket.on("update_leaderboard", function(leadersObject) {
  if (isHost) {
    for (let i = 1; i <= 10; i++) {
      if (leadersObject[i][0] != "") {
        document.getElementById("player-" + i + "-leaderboard-nickname").innerHTML = (leadersObject[i][0]).toUpperCase();
        document.getElementById("player-" + i + "-leaderboard-score").innerHTML = numberWithCommas(leadersObject[i][1]);
      }
    }
  }
});

socket.on("join_session_success", function(rejoinable, sessionId) {
  if (!isHost) {
    // The session ID is on the waiting screen for other players who may
    // want to join to see
    document.getElementById("session-id-footer").innerHTML = sessionId;
    if (rejoinable) {
      changeScreen("start-game-screen");
      toggleRejoinGameButton(true);
    } else {
      changeScreen("c-landing-screen");
    }
  }
});

socket.on("join_session_failure", function(attemptedSessionId) {
  if (!isHost) {
    alert(attemptedSessionId + " is not a valid session ID");
  }
});

socket.on("update_players_connected", function(nickname, playerNum, connecting) {
  // Connecting is a boolean that is true if the player is trying to connect
  // or is disconnecting

  if (isHost) {
    if (connecting) {
      if (playerNum <= 8) {
        // Shows the connected player's nickname on screen
        let element = document.getElementById("player-" + playerNum);
        element.innerHTML = nickname.toUpperCase();
        // Adds an opacity animation that shows the nickname "fading in"
        element.classList.add("animate");
      } else {
        overflowNicknames.push(nickname);
      }
    } else {
      for (let i = 1; i <= 8; i++) {
        let element = document.getElementById("player-" + i);

        if (element.innerHTML == nickname.toUpperCase()) {
          // Pushes all nicknames up one space so there's no whitespace left by
          // the disconnected player's nickname
          for (let j = 1; j <= 7; j++) {
            document.getElementById("player-" + j).innerHTML = document.getElementById("player-" + (j + 1)).innerHTML;

            if (document.getElementById("player-" + j).innerHTML == "") {
              document.getElementById("player-" + j).className = "";
            }
          }

          // The above loop could leave the 8th player position empty and if there
          // is another player to occupy that position, this pushes the nickname to that position
          if (playerNum >= 8) {
            document.getElementById("player-" + 8).innerHTML = overflowNicknames.shift();
          }

          break;
        }
      }
    }
  }
});

socket.on("update_players", function(newPlayers) {
  if (isHost) {
    players = newPlayers;
  }
});

socket.on("join_success", function(
  boardController,
  gameActive,
  categoryNames,
  categoryDates
) {

  // gameActive is a boolean that tells if the game is currently going on (true)
  // or if it is about to start (false)
  //
  // waitingToJoin is on if the game is going on when a player tries to join.
  // This way the player won't be allowed into the game until the current clue is over

  setCategoryText(categoryNames, categoryDates);

  if (gameActive) {
    joined = false;
    waitingToJoin = true;
    changeWaitScreen("NEXT CLUE");
  } else {
    joined = true;
  }

  // The current board controller (the first player to join the session) is the
  // one who starts the game
  if (socket.id == boardController && !gameActive) {
    changeScreen("start-game-screen");
  } else {
    if (!gameActive) {
      changeWaitScreen("GAME TO START");
    }
  }
});

socket.on("change_start_game_player", function(boardController) {
  if (!isHost) {
    if (socket.id == boardController) {
      changeScreen("start-game-screen");
    }
  }
});

socket.on("start_game_failure", function() {
  alert(
    "You need to unmute the game in order to start (Click unmute on the host screen)"
  );
});

socket.on("load_game", function(
  categoryNames,
  categoryDates,
  boardController,
  boardControllerNickname
) {

  setCategoryText(categoryNames, categoryDates);

  if (isHost) {
    // Adjusts the scoreboard to reflect the number of players at the game when it starts
    // This prevents the disjointing appearance of 3 empty podiums switching to just 2
    updateScoreboard(players);
    audioFiles["landing_screen_theme"].pause();
    say(getRandomBoardControllerIntro() + boardControllerNickname, 0.1);
    changeScreen("h-board-screen");

    document.body.style.backgroundImage = "url('/graphics/background.png')";
  } else {
    if (joined) {
      if (socket.id == boardController) {
        changeScreen("c-board-screen");
      } else {
        changeWaitScreen(boardControllerNickname.toUpperCase());
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("display_daily_double_panel", function(
  clueRequest,
  screenQuestion,
  boardController,
  boardControllerNickname
) {

  if (isHost) {
    clearLastPlayerAnswer();
    playAudio("daily_double");
    displayClue(clueRequest, screenQuestion, true);
    currentScreenQuestion = screenQuestion;
    setTimeout(function() {
      socket.emit("request_daily_double_wager");
    }, 3000);
  } else {
    if (joined) {
      if (socket.id == boardController) {
        changeWaitScreen("SCREEN");
      } else {
        changeWaitScreen(boardControllerNickname.toUpperCase());
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("get_daily_double_wager", function(
  categoryName,
  player,
  newMaxWager
) {

  buzzWinner = player;
  dailyDouble = true;

  if (isHost) {
    startTimerAnimation(15);
    requestDailyDoubleWager(categoryName, player.nickname, player.score);
    say(getRandomWagerIntro() + player.nickname, 0.1);
  } else {
    if (joined) {
      if (socket.id == player.id) {
        toggleWagerForm(true);
        changeScreen("answer-screen");
        startTimerAnimation(15);
        maxWager = newMaxWager;
        startWagerLivefeedInterval();
        scrapeWagerTimeout = setTimeout(function() {
          submitWager(true);
        }, 15000);
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("wager_livefeed", function(wagerLivefeed) {
  if (isHost && wagerLivefeed != "") {
    if (dailyDouble) {
      document.getElementById("player-livefeed").innerHTML =
        "$" + wagerLivefeed.toUpperCase();
    }
  }
});

socket.on("display_daily_double_clue", function(screenQuestion) {
  disableTimer();

  if (isHost) {
    let clueText = document.getElementById("clue-text");

    clueText.innerHTML = screenQuestion;
    adjustClueFontSize(screenQuestion, false);

    say(screenQuestion, 0.1);
    setTimeout(startQuestionInterval, 2500);
    clearLastPlayerAnswer();

    document
      .getElementById("player-livefeed-wrapper")
      .classList.add("inactive");
  }
});

socket.on("get_daily_double_answer", function(player) {

  buzzWinner = player;

  if (isHost) {
    startTimerAnimation(15);
    setupPlayerLivefeed(player, currentScreenQuestion);
    clearLastPlayerAnswer();
  } else {
    if (joined) {
      if (socket.id == player.id) {
        startTimerAnimation(15);
        scrapeAnswerTimeout = setTimeout(submitAnswer, 15000);
        changeScreen("answer-screen");
        toggleWagerForm(false);
        startAnswerLivefeedInterval();
      } else {
        changeWaitScreen(player.nickname);
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("answer_livefeed", function(livefeed) {
  if (isHost) {
    if (!finalJeoparty) {
      if (livefeed != "") {
        document.getElementById(
          "player-livefeed"
        ).innerHTML = livefeed.toUpperCase();
      }
    }
  }
});

socket.on("answer_submitted", function(answer, correct) {
  disableTimer();

  if (isHost) {
    displayPlayerAnswer(buzzWinner, answer, correct);
  } else {
    if (joined) {
      changeWaitScreen("SCREEN");
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("reveal_scores", function() {
  if (isHost) {
    changeScreen("clue-screen");
    changeScreen("score-screen");

    // Shows what the scores were before this round for 1 second then updates
    // them to show how the scores have changed
    setTimeout(function() {
      updateScoreboard(players);
    }, 1000);
  }
});

socket.on("setup_double_jeoparty", function(categoryNames, categoryDates) {
  setDoubleJeopartyPriceText();
  setCategoryText(categoryNames, categoryDates);
  if (isHost) {
    clearLastPlayerAnswer();
  }
});

socket.on("setup_final_jeoparty", function(clue) {
  finalJeoparty = true;
  finalJeopartyClue = clue;

  let categoryName = clue["category"]["title"];
  let categoryDate = clue["airdate"].slice(0, 4);

  if (isHost) {
    document.getElementById("clue-screen").className = "static-clue-screen";
    currentScreenId = "clue-screen";
    say(getRandomFinalJeopartyIntro());
    document.getElementById("clue-text").innerHTML = "";
    clearLastPlayerAnswer();

    setTimeout(function() {
      playAudio("final_jeoparty");
      say(categoryName, .5);
      displayFinalJeopartyCategory(categoryName, categoryDate);
      setTimeout(function() {
        let clueText = document.getElementById("clue-text");
        clueText.className = "clue-text";

        socket.emit("request_final_jeoparty_wager");
      }, 3000);
    }, 3000);
  } else {
    if (joined) {
      changeWaitScreen("SCREEN");
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("display_correct_answer", function(correctAnswer, timesUp) {
  disableTimer();

  if (isHost) {
    if (timesUp) {
      playAudio("times_up");
    }
    document.getElementById("player-livefeed-wrapper").className = "inactive";
    say(getRandomAnswerIntro() + correctAnswer, .5);
    displayCorrectAnswer(correctAnswer);
  } else {
    if (joined) {
      if (timesUp) {
        toggleBlinkingBuzzerLight(false);
      }
      changeWaitScreen("SCREEN");
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("reveal_board", function(
  newUsedClues,
  remainingClueIds,
  boardController,
  boardControllerNickname
) {

  if (!finalJeoparty) {
    dailyDouble = false;

    if (isHost) {
      changeScreen("h-board-screen");
      document.getElementById("clue-screen").classList.remove("animate");
      if (remainingClueIds.length != 1) {
        say(getRandomBoardControllerIntro() + boardControllerNickname, 0.1);
      }
    } else {
      if (joined || waitingToJoin) {
        waitingToJoin = false;
        joined = true;

        if (socket.id == boardController) {
          if (remainingClueIds.length == 1) {
            // Automatically sends the final clue request to the server
            // if there is only one clue left on the board
            lastCategoryId = remainingClueIds[0].slice(0, 10);
            lastPriceId = remainingClueIds[0].slice(11);
            sendClueRequest();
          } else {
            changeScreen("c-board-screen");
            resetClueButtons();
            resetCluePriceButtons();
          }
        } else {
          changeWaitScreen(boardControllerNickname.toUpperCase());
        }
      }
    }
    usedClues = newUsedClues;
    updateCategoryOptions();
  }
});

socket.on("display_clue", function(clueRequest, screenQuestion) {
  if (isHost) {
    playAudio("clue_selected");
    say(screenQuestion, 1);
    setTimeout(startQuestionInterval, 2500);
    clearLastPlayerAnswer();
    displayClue(clueRequest, screenQuestion, false);
    currentScreenQuestion = screenQuestion;
  } else {
    if (joined) {
      changeScreen("buzzer-screen");
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("buzzers_ready", function(playersAnswered) {
  if (isHost) {
    startTimerAnimation(5);

    // Shows the clue on screen if the buzzer is being activated after another
    // player attempted to answer and was wrong
    if (playersAnswered.length > 0) {
      document.getElementById("clue-text").innerHTML = currentScreenQuestion;
      adjustClueFontSize(currentScreenQuestion, false);
      clearLastPlayerAnswer();
    }
  } else {
    if (joined) {
      if (playersAnswered.includes(socket.id)) {
        changeWaitScreen("OTHER PLAYERS");
      } else {
        changeScreen("buzzer-screen");
        toggleBlinkingBuzzerLight(true);

        startTimerAnimation(5);
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("get_answer", function(player) {
  disableTimer();

  buzzWinner = player;

  // Delayed to allow the disableTimer call to finish its changes
  setTimeout(function() {
    startTimerAnimation(15);
  }, 1);

  if (isHost) {
    playAudio("buzzer");
    setupPlayerLivefeed(buzzWinner, currentScreenQuestion);
    clearLastPlayerAnswer();
  } else {
    if (joined) {
      toggleBlinkingBuzzerLight(false);

      // This player won the buzz
      if (socket.id == player.id) {
        // Set to 15000 ms because an immediate scrape caused timing problems
        scrapeAnswerTimeout = setTimeout(submitAnswer, 15000);

        changeBuzzerLightColor(true, true);

        setTimeout(function() {
          changeScreen("answer-screen");
          startAnswerLivefeedInterval();
          changeBuzzerLightColor(false, false);
        }, 200);
      } else {
        changeBuzzerLightColor(true, false);
        setTimeout(function() {
          changeWaitScreen(player.nickname.toUpperCase());
          changeBuzzerLightColor(false, false);
        }, 200);
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("get_final_jeoparty_wager", function(finalJeopartyPlayers) {
  if (isHost) {
    startTimerAnimation(15);
    changeScreen("score-screen");
    changeTimerHeight(true);
    say(getRandomWagerIntro());
  } else {
    if (joined) {
      if (Object.keys(finalJeopartyPlayers).includes(socket.id)) {
        finalJeopartyPlayer = true;
        toggleWagerForm(true);
        startWagerLivefeedInterval();
        changeScreen("answer-screen");

        startTimerAnimation(15);

        maxWager = finalJeopartyPlayers[socket.id].maxWager;
        scrapeWagerTimeout = setTimeout(function() {
          submitWager(true);
        }, 15000);
      } else {
        changeWaitScreen("BANKRUPT", true);
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});


socket.on("display_final_jeoparty_clue", function() {
  disableTimer();

  if (isHost) {
    changeScreen("clue-screen");
    changeTimerHeight(false);

    let clueText = document.getElementById("clue-text");
    let screenQuestion = finalJeopartyClue["screen_question"];

    clueText.innerHTML = screenQuestion;
    adjustClueFontSize(screenQuestion, false);

    playAudio("final_jeoparty");
    say(screenQuestion, 0.5);
    setTimeout(startQuestionInterval, 2500);
    clearLastPlayerAnswer();

    document
      .getElementById("player-livefeed-wrapper")
      .classList.add("inactive");
  } else {
    if (joined) {
      if (finalJeopartyPlayer) {
        toggleWagerForm(false);
        changeWaitScreen("SCREEN");
      } // Bankrupt players are still locked out from doing anything else in the game
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("get_answer_final_jeoparty", function() {
  disableTimer();

  if (isHost) {
    playAudio("think_music");
    setTimeout(function() {
      startTimerAnimation(30);
    }, 1);
  } else {
    if (joined) {
      if (finalJeopartyPlayer) {
        setTimeout(function() {
          startTimerAnimation(30);
        }, 1);

        scrapeAnswerTimeout = setTimeout(submitAnswer, 30000);
        changeScreen("answer-screen");
        startAnswerLivefeedInterval();
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("display_final_jeoparty_answers", function(players) {
  disableTimer();

  if (isHost) {
    displayFinalJeopartyAnswers(players);

  } else {
    if (joined) {
      if (finalJeopartyPlayer) {
        changeWaitScreen("SCREEN");
      }
    } else if (!waitingToJoin) {
      resetGame(true);
    }
  }
});

socket.on("change_board_controller", function(
  boardController,
  boardControllerNickname
) {

  if (isHost) {
    say(getRandomBoardControllerIntro() + boardControllerNickname, 0.1);
  } else {
    if (boardController == socket.id) {
      changeScreen("c-board-screen");
    } else {
      changeWaitScreen(boardControllerNickname.toUpperCase());
    }
  }
});

socket.on("reset_game", function(refresh) {
  resetGame(refresh);
});

// Game logic

function resetGame(refresh) {
  // Resetting all variables
  waitingToJoin = false;
  joined = false;
  currentScreenId = undefined;
  isHost = undefined;
  audioAllowed = false;
  audioFiles = undefined;
  players = undefined;
  lastCategoryWrapperId = undefined;
  lastCategoryId = undefined;
  lastPriceWrapperId = undefined;
  lastPriceId = undefined;
  buzzWinner = undefined;
  usedClues = undefined;
  currentScreenQuestion = undefined;
  doubleJeoparty = false;
  maxWager = undefined;
  dailyDouble = false;
  finalJeoparty = false;
  finalJeopartyClue = undefined;
  finalJeopartyPlayer = undefined;

  currentScreenId = "join-session-screen";
  changeScreen("c-landing-screen");

  if (refresh && (currentScreenId != "join-session-screen") && (currentScreenId != "c-landing-screen")) {
    // Refreshes the browser
    window.location.href = window.location.href;
  }
}


function declareAudioFiles() {
  /*
  Declares every audio file used throughout the game. This needs to be called
  by a player input in order for the browser to allow any audio to be played so
  audio is turned on when a player clicks anywhere on the host screen
   */

  if (!audioAllowed) {
    // Turns off the text telling the players to unmute the game
    document.getElementById("unmute-text").classList.add("inactive");

    audioAllowed = true;
    socket.emit("audio_allowed");

    audioFiles = {
      landing_screen_theme: new Audio("/audio/landing_screen_theme.mp3"),
      clue_selected: new Audio("/audio/clue_selected.mp3"),
      buzzer: new Audio("/audio/buzzer.mp3"),
      times_up: new Audio("/audio/times_up.mp3"),
      applause: new Audio("/audio/applause.mp3"),
      aww: new Audio("/audio/aww.mp3"),
      daily_double: new Audio("/audio/daily_double.mp3"),
      final_jeoparty: new Audio("/audio/final_jeoparty.mp3"),
      think_music: new Audio("/audio/think_music.mp3"),
      big_applause: new Audio("/audio/big_applause.mp3")
    };

    playAudio("landing_screen_theme", true);
  }
}


function playAudio(filename, loop = false) {
  /*
  Plays filename's audio clip
   */

  if (audioAllowed) {
    if (audioFiles[filename].paused) {
      audioFiles[filename].play();
      if (loop) {
        audioFiles[filename].loop = true;
      }
    }
  }
}


function joinSession() {
  /*
  Sends the requested session ID to the server to attempt to join it
   */

  // Cookie variable holds a random string of numbers that represent this device
  // This is meant to replace using an IP address which isn't static for phones
  if (document.cookie == "") {
    document.cookie = Math.random().toString(36).substr(2, 20).toUpperCase();
  }

  socket.emit(
    "join_session",
    document.getElementById("session-id-form").value.toUpperCase(),
    document.cookie
  );
}

function alertHelpMenu() {
  /*
  Alerts the player with a list of game instructions and copyright information
   */

  if (currentScreenId == "join-session-screen") {
    alert("Go to jeoparty.io on your computer to find a session ID");
  } else {
    alert(
      "Jeoparty!\r\r1. Choose a nickname and signature. These will represent you on your podium in the game. Press down hard on your screen to sign your signature, the lines will appear cleaner.\r\r2. Once the first player presses the 'Start Game' button, the game will begin, but any number of extra players can join anytime afterward.\r\r3. Plug your laptop into a TV for maximum enjoyment.\r\r4. Select clues on your phone by choosing a category, a price, then hitting the 'Submit Clue' button.\r\r5. The answer evaluator favors a 'less is more' approach. If you're worried about something being plural, just use the singular form. It's also preferable to answer with last names instead of full names when applicable.\r\r6. The rest of the game proceeds like the Jeopardy! TV series. Enjoy!\r\rThe Jeopardy! game show and all elements thereof, including but not limited to copyright and trademark thereto, are the property of Jeopardy Productions, Inc. and are protected under law. This website is not affiliated with, sponsored by, or operated by Jeopardy Productions, Inc.\r\rAn Isaac Redlon Production. 2018."
    );
  }
}


function toggleRejoinGameButton(on) {
  /*
  If on, activates a button to let the player rejoin the game, else,
  reactivates the start game button
   */

  let startGameButton = document.getElementById("start-game-button");
  let rejoinGameButton = document.getElementById("rejoin-game-button");

  if (on) {
    startGameButton.classList.add("inactive");
    rejoinGameButton.classList.remove("inactive");
  } else {
    startGameButton.classList.remove("inactive");
    rejoinGameButton.classList.add("inactive");
  }
}


function rejoinGame() {
  socket.emit("rejoin_game");
}


function joinGame() {
  /*
  Sends the player's custom nickname and signature to the server to join the game
   */

  let nickname = document.getElementById("nickname-form").value;
  let signature = document.getElementById("sketchpad").toDataURL("image/png");

  // Names that are too long slow down the game from being read out lou
  if (nickname.length <= 15) {
    socket.emit("join_game", nickname, signature);
  } else {
    alert("Your nickname is too long");
  }
}


function setCategoryText(categoryNames, categoryDates) {
  /*
  Displays each category name and date in the appropriate box on the board screen
   */

  if (categoryNames.length == 6 && categoryDates.length == 6) {
    let categoryNameElement;

    for (let i = 1; i < 7; i++) {
      if (isHost) {
        categoryNameElement = document.getElementById("category-" + i + "-name");
        categoryNameElement.innerHTML = categoryNames[i - 1].toUpperCase();

        document.getElementById("category-" + i + "-date").innerHTML =
          "(" + categoryDates[i - 1] + ")";

        // Changes the font size of the category name depending on how many letters
        // it has in it
        // This prevents the category names from "bursting out" of its box
        if (categoryNames[i - 1].length > 45) {
          categoryNameElement.className = "xxxs-h-category-name";
        } else if (categoryNames[i - 1].length > 32) {
          categoryNameElement.className = "xxs-h-category-name";
        } else if (categoryNames[i - 1].length > 24) {
          categoryNameElement.className = "xs-h-category-name";
        } else if (categoryNames[i - 1].length > 10) {
          categoryNameElement.className = "s-h-category-name";
        } else {
          categoryNameElement.className = "h-category-name";
        }
      } else {
        categoryNameElement = document.getElementById("category-" + i + "-text");
        categoryNameElement.innerHTML = categoryNames[i - 1].toUpperCase();

        if (categoryNames[i - 1].length > 45) {
          categoryNameElement.className = "xxs-c-category-text";
        } else if (categoryNames[i - 1].length > 30) {
          categoryNameElement.className = "xs-c-category-text";
        } else if (categoryNames[i - 1].length > 13) {
          categoryNameElement.className = "s-c-category-text";
        }
      }
    }
  }
}


function startGame() {
  let start = confirm("Are you sure everyone has joined the game?");

  if (start) {
    socket.emit("start_game");
  }
}


function changeScreen(newScreen) {
  /*
  Disables the current screen element and enables the newScreen element
   */

  document.getElementById(currentScreenId).classList.add("inactive");
  document.getElementById(newScreen).classList.remove("inactive");
  currentScreenId = newScreen;
}


function say(text, delay) {
  /*
  Uses the browser's built-in speech synthesis to speak text out loud
   */

  if (audioAllowed) {
    speechSynthesis.cancel();

    text = removeBlanks(text);

    setTimeout(function() {
      if (window.speechSynthesis.getVoices().length == 0) {
        window.speechSynthesis.onvoiceschanged = function() {
          textToSpeech(text);
        };
      } else {
        textToSpeech(text);
      }

      function textToSpeech(text) {
        let msg = new SpeechSynthesisUtterance();
        let voices = window.speechSynthesis.getVoices();

        msg.voice = voices[1];

        for (let i = 0; i < voices.length; i++) {
          if (voices[i].name === 'Google UK English Male') {
            msg.voice = voices[i];
          }
        }

        msg.voiceURI = "native";
        msg.volume = 1;
        msg.rate = 1;
        msg.pitch = 1;
        msg.text = text;
        msg.lang = "en-US";

        if (!speechSynthesis.speaking) {
          speechSynthesis.speak(msg);
        }
      }
    }, delay * 1000);
  }
}


function removeBlanks(text) {
  /*
  Turns any series of underscores in text into the word blank so that
  the text to speech delivers the blank section as "blank" instead of
  "underscore underscore underscore"
   */

  while (text.includes("_")) {
    let start = text.indexOf("_");
    let end;

    let i = text.indexOf("_");
    while (true) {
      if (text[i] != "_") {
        end = i;
        break;
      }
      i++;
    }

    text = text.replace(text.slice(start, end), "blank");
  }

  return text;
}


function startQuestionInterval() {
  /*
  Starts interval to check if the question is done being read by text to speech
   */

  questionInterval = setInterval(function() {
    if (!window.speechSynthesis.speaking) {
      clearInterval(questionInterval);

      if (dailyDouble) {
        socket.emit("request_daily_double_answer");
      } else if (finalJeoparty) {
        socket.emit("request_final_jeoparty_answer");
      } else {
        socket.emit("activate_buzzers");
      }
    }
  }, 250);
}


function changeWaitScreen(waitingForText, override = false) {
  /*
  Displays the waiting screen and shows who the player is waiting for
   */

  let prefix;

  // Override stops the usual "WAITING FOR X" format of the wait screen
  if (override) {
    prefix = "";
  } else {
    prefix = "WAITING FOR ";
  }

  // Ensures that the current screen is "c-waiting-screen"
  if (currentScreenId != "c-waiting-screen") {
    document.getElementById(currentScreenId).classList.add("inactive");
    document.getElementById("c-waiting-screen").classList.remove("inactive");

    currentScreenId = "c-waiting-screen";
  }

  document.getElementById("c-waiting-screen-text").innerHTML =
    prefix + waitingForText.toUpperCase();
}

function adjustMobileStyle() {
  /*
  Changes the styling of controller screens to fit the device's screen size.
  This prevents smaller phones screens from cutting off the display
  */

  // Prevents the page from being scrolled
  document.body.style.position = "fixed";

  // Stores all of the divs inside of index.html that hold game screens
  let gameScreenIds = [
    "join-session-screen",
    "c-landing-screen",
    "c-waiting-screen",
    "start-game-screen",
    "c-board-screen",
    "buzzer-screen",
    "answer-screen"
  ];

  for (let i = 0; i < gameScreenIds.length; i++) {
    // This is neccessary because 100vh on iOS Safari extends past the visible
    // screen area which makes the player swipe up and down to play the game
    document.getElementById(gameScreenIds[i]).style.height =
      window.innerHeight + "px";
  }

  // Adjusts the height of the "board rows" on the board screen where players
  // select clues
  for (let j = 1; j <= 5; j++) {
    document.getElementById("c-board-row" + "-" + j).style.height =
      window.innerHeight / 5 + "px";
  }

  // Moves the position of the "X" button on the sketchpad to be in the upper
  // right hand corner of the sketchpad
  document.getElementById("erase").style.left =
    (window.innerWidth - 250) / 2 + 220 + "px";
}


function pressClueButton(button) {
  /*
  Highlights the button that was pressed and un-highlights the last button of
  that type to be pressed
   */

  let wrapper = document.getElementById(button.id + "-wrapper");

  if (wrapper.classList.contains("category")) {
    updateClueOptions(button.id);
    try {
      document
        .getElementById(lastCategoryWrapperId)
        .classList.remove("highlighted");
    } catch (e) {
      // In case lastCategoryWrapperId has not been defined yet
    }
    lastCategoryWrapperId = wrapper.id;
    lastCategoryId = button.id;

    wrapper.classList.add("highlighted");
  }

  if (wrapper.classList.contains("price")) {
    try {
      document
        .getElementById(lastPriceWrapperId)
        .classList.remove("highlighted");
    } catch (e) {
      // In case lastPriceWrapperId has not been defined yet
    }
    lastPriceWrapperId = wrapper.id;
    lastPriceId = button.id;

    wrapper.classList.add("highlighted");
  }
}


function updateCategoryOptions() {
  /*
  Removes the categoryName on the board screen of any completed category
   */

  let idSuffix;

  if (isHost) {
    idSuffix = "-name";
  } else {
    idSuffix = "-text";
  }

  for (let i = 1; i < 7; i++) {
    let categoryButton = document.getElementById("category-" + i);
    let categoryButtonText = document.getElementById(
      "category-" + i + idSuffix
    );

    if (usedClues["category-" + i].length == 5) {
      categoryButton.disabled = true;
      categoryButtonText.innerHTML = "";

      if (isHost) {
        document.getElementById("category-" + i + "-date-wrapper").className =
          "inactive category-date-wrapper";
      }
    } else {
      categoryButton.disabled = false;

      if (isHost) {
        document.getElementById("category-" + i + "-date-wrapper").className =
          "category-date-wrapper";
      }
    }
  }
}

function updateClueOptions(categoryId) {
  /*
  Removes the option to select certain price values depending on the category
  that the player pressed

  i.e. if the $200 and $400 question in Category 1 have been selected already,
  the only options available for the player to use are $600, $800, and $1000
   */

  if (usedClues) {
    resetCluePriceButtons();

    for (let i = 0; i < usedClues[categoryId].length; i++) {
      let priceButton = document.getElementById(usedClues[categoryId][i]);
      let priceButtonText = document.getElementById(
        usedClues[categoryId][i] + "-text"
      );

      priceButton.disabled = true;

      priceButtonText.innerHTML = "";
    }
  }
}


function resetCluePriceButtons() {
  /*
  Activates and resets the text of every clue price button
  on the controller board screen. This is to make the board screen
  a blank slate for the player's selection
   */

  let prices;

  if (doubleJeoparty) {
    prices = {
      1: "$400",
      2: "$800",
      3: "$1.2K",
      4: "$1.6K",
      5: "$2K"
    };
  } else {
    prices = {
      1: "$200",
      2: "$400",
      3: "$600",
      4: "$800",
      5: "$1K"
    };
  }

  for (let i = 1; i < 6; i++) {
    document.getElementById("price-" + i).disabled = false;

    let priceButtonText = document.getElementById("price-" + i + "-text");
    priceButtonText.innerHTML = prices[i];
  }
}


function getRandomBoardControllerIntro() {
  /*
  Returns a random string from intros for the text to speech say before
  asking the board controller to select a clue. A full text to speech statement
  would sound like, "Pick a category nickname"
   */

  let intros = [
    "Pick a category ",
    "It's your choice",
    "You control the board ",
    "Make a selection ",
    "The choice is yours ",
    "Take your pick ",
    "Pick a clue ",
    "Select a clue "
  ];

  let intro = intros[Math.floor(Math.random() * intros.length)];

  return intro;
}


function sendClueRequest() {

  // lastCategoryId and lastPriceId are assigned when the player presses buttons
  // on the clue selection screen so if nothing has been clicked, no clue has
  // been requested
  if (lastCategoryId != undefined && lastPriceId != undefined) {
    let clueRequest = lastCategoryId + "-" + lastPriceId;
    socket.emit("request_clue", clueRequest);

    lastCategoryId = undefined;
    lastPriceId = undefined;
  }
}


function displayClue(clueRequest, screenQuestion, dailyDouble) {
  /*
  Highglights the clue element on the host board screen then animates the
  clue screen to appear overtop of the board
   */

  let clueElement = document.getElementById(clueRequest);

  moveClueScreen(clueRequest);

  let clueText = document.getElementById("clue-text");

  if (dailyDouble) {
    document.getElementById(clueRequest + "-text").innerHTML = "";
    document.getElementById("daily-double-wrapper").className = "daily-double-wrapper-screen";
    document.getElementById("clue-screen").className = "daily-double-screen";

    setTimeout(animateClueScreen, 10);

    clueText.className = "daily-double-text";
    clueText.innerHTML = "DAILY DOUBLE";
  } else {
    clueElement.classList.add("highlighted");

    clueText.innerHTML = screenQuestion;
    adjustClueFontSize(screenQuestion, false);

    setTimeout(function() {
      // Keeps the "highlighted" tile on screen for 1 second before revealing
      // the clue
      document.getElementById(clueRequest + "-text").innerHTML = "";
      clueElement.classList.remove("highlighted");
      document.getElementById("clue-screen").classList.remove("inactive");
      setTimeout(animateClueScreen, 10);
    }, 1000);
  }
}

function adjustClueFontSize(question, livefeed) {
  /*
  Adjusts the font size of the clue depending on how long it is,
  and whether or not it is being displayed on top of a livefeed or not
   */

  let clueText = document.getElementById("clue-text");

  // Player livefeed basically places a large text element on the bottom of the
  // screen so the clue should be smaller to accomodate the room the livefeed
  // is taking up on screen
  if (livefeed) {
    if (question.length > 300) {
      clueText.className = "xxxs-clue-text";
    } else if (question.length > 200) {
      clueText.className = "xxs-clue-text";
    } else if (question.length > 145) {
      clueText.className = "xs-clue-text";
    } else {
      clueText.className = "s-clue-text";
    }
    // Otherwise just change the font size so it fits on screen in general
  } else {
    if (question.length > 300) {
      clueText.className = "xxs-clue-text";
    } else if (question.length > 200) {
      clueText.className = "xs-clue-text";
    } else if (question.length > 145) {
      clueText.className = "s-clue-text";
    } else {
      clueText.className = "clue-text";
    }
  }
}


function moveClueScreen(clueRequest) {
  /*
  Changes the position of the clue screen to be above the clue element
  of the clue that was selected
  This is done to emulate the effect of the clue screen starting from the clue
  position it was selected from on the board and then "blowing up" to full size
   */

  let category = clueRequest.slice(0, 10);
  let price = clueRequest.slice(11);

  // Each category and price on the board is at a certain grid position
  // and their combination gives the correct position to place the tiny clue screen
  let positionIndex = {
    "category-1": "-41.85vw",
    "category-2": "-25.1vw",
    "category-3": "-8.4vw",
    "category-4": "8.4vw",
    "category-5": "25.1vw",
    "category-6": "41.85vw",
    "price-1": "25vh",
    "price-2": "8vh",
    "price-3": "-8vh",
    "price-4": "-25vh",
    "price-5": "-42vh"
  };

  let clueScreen = document.getElementById("clue-screen");

  clueScreen.style.left = positionIndex[category];
  clueScreen.style.bottom = positionIndex[price];
}


function animateClueScreen() {
  /*
  Animates the rapid scaling and opacity increase of the clue screen
   */

  let clueScreen = document.getElementById("clue-screen");

  // Brings the clue to the bottom left corner so that when it reaches
  // full size it fills up the entire screen
  clueScreen.style.left = "0vw";
  clueScreen.style.bottom = "0vh";

  // The CSS class "animate" rapidly scales and increases the opacity of the clue screen
  clueScreen.classList.add("animate");
}


function toggleWagerForm(on) {
  let answerForm = document.getElementById("answer-form-wrapper");
  let wagerForm = document.getElementById("wager-form-wrapper");

  let submitAnswerButton = document.getElementById("submit-answer-button");
  let submitWagerButton = document.getElementById("submit-wager-button");

  if (on) {
    answerForm.classList.add("inactive");
    wagerForm.classList.remove("inactive");

    submitAnswerButton.classList.add("inactive");
    submitWagerButton.classList.remove("inactive");
  } else {
    answerForm.classList.remove("inactive");
    wagerForm.classList.add("inactive");

    submitAnswerButton.classList.remove("inactive");
    submitWagerButton.classList.add("inactive");
  }
}


function getRandomWagerIntro() {
  /*
  Returns a random string from intros for the text to speech say before
  asking the player(s) to make a wager. A full text to speech statement
  would sound like, "Choose you wager nickname"
   */

  let intros;

  if (finalJeoparty) {
    intros = ["Choose your wagers", "Make your wagers", "It's time to wager"];
  } else {
    intros = ["Choose your wager ", "Make a wager ", "It's time to wager "];
  }

  let intro = intros[Math.floor(Math.random() * intros.length)];

  return intro;
}


function requestDailyDoubleWager(categoryName, nickname, score) {
  /*
  Displays relevant data on the clue screen while the daily double
  winner is deciding their wager
   */

  document.getElementById("daily-double-wrapper").className = "";
  document.getElementById("clue-screen").className = "clue-screen animate";

  let clueText = document.getElementById("clue-text");
  clueText.className = "xs-clue-text";

  // Shows the current category and the player's current money so the player can
  // use it consider it their wager amoutn
  clueText.innerHTML = "<u>CATEGORY</u><br>" + categoryName.toUpperCase();

  if (score < 0) {
    clueText.innerHTML +=
      "<br>" +
      "<u>" +
      nickname.toUpperCase() +
      "'S MONEY</u><br>-$" +
      numberWithCommas(Math.abs(score));
  } else {
    clueText.innerHTML +=
      "<br>" + "<u>" + nickname.toUpperCase() + "'S MONEY</u><br>$" + numberWithCommas(score);
  }

  document.getElementById("player-livefeed").innerHTML = "";
  document.getElementById("player-livefeed-spacer").style.height = "6vh";

  document
    .getElementById("player-livefeed-wrapper")
    .classList.remove("inactive");
  document.getElementById("player-livefeed-nickname").innerHTML =
    "<u>" + nickname.toUpperCase() + "</u><br>";
}


function startWagerLivefeedInterval() {
  /*
  Starts interval to send the player's wager form to the server as they are typing
   */

  let wagerForm = document.getElementById("wager-form");

  wagerLivefeedInterval = setInterval(function() {
    socket.emit("wager_livefeed", wagerForm.value);

    // Turns on the submit button once something has been typed
    if (wagerForm.value.length > 0) {
      document
        .getElementById("submit-wager-button")
        .classList.remove("inactive");
    }
  }, 100);
}


function submitWager(timesUp) {
  let wagerForm = document.getElementById("wager-form");
  let wager = wagerForm.value;

  let minWager;

  if (dailyDouble) {
    minWager = 5;
  } else {
    minWager = 0;
  }

  clearInterval(wagerLivefeedInterval);
  clearTimeout(scrapeWagerTimeout);

  // If the player's time to wager is up there will be no alert to warn them
  // that their wager won't work
  if (timesUp) {
    if (dailyDouble) {
      changeWaitScreen("SCREEN");
    } else {
      changeWaitScreen("OTHER PLAYERS");
    }

    // Wager being anything besides a number and this number being less than
    // the minimum wager or more than the maximum wager constitutes an illegal
    // wager and it is assumed to be whatever minWager was set to above
    if (!isNaN(wager) && (Number(wager) > minWager) && (Number(wager) < maxWager)) {
      if (dailyDouble) {
        socket.emit("daily_double_wager", Number(wager));
      } else {
        socket.emit("final_jeoparty_wager", Number(wager));
      }
    } else {
      if (dailyDouble) {
        socket.emit("daily_double_wager", minWager);
      } else {
        socket.emit("final_jeoparty_wager", minWager);
      }
    }
    wagerForm.value = "";
  } else {
    if (isNaN(wager)) {
      alert("Enter a number");
    } else {
      if (Number(wager) < minWager) {
        alert("Minimum wager is $" + minWager);
      } else if (Number(wager) > maxWager) {
        alert("Maximum wager is $" + maxWager);
      } else {
        if (dailyDouble) {
          socket.emit("daily_double_wager", Number(wager));
          changeWaitScreen("SCREEN");
        } else {
          socket.emit("final_jeoparty_wager", Number(wager));
          changeWaitScreen("OTHER PLAYERS");
        }
        wagerForm.value = "";
      }
    }
  }
}


function startTimerAnimation(time) {
  /*
  Activates the timer and timer frame elements, then animates the timer
  decreasing over the given time period
   */

  let timerId;
  let timerFrameId;

  if (isHost) {
    timerId = "h-timer";
    timerFrameId = "h-timer-frame";
  } else {
    timerId = "c-timer";
    timerFrameId = "c-timer-frame";
  }

  let timer = document.getElementById(timerId);
  let timerFrame = document.getElementById(timerFrameId);

  timer.className = timerId;
  timerFrame.className = timerFrameId;

  timer.style.transition = "linear transform " + time + "s";

  setTimeout(function() {
    timer.className = "animate " + timerId;
  }, 100);
}


function disableTimer() {
  /*
  Disables the timer and timer frame elements
   */

  let timerId;
  let timerFrameId;

  if (isHost) {
    timerId = "h-timer";
    timerFrameId = "h-timer-frame";
  } else {
    timerId = "c-timer";
    timerFrameId = "c-timer-frame";
  }

  let timer = document.getElementById(timerId);
  let timerFrame = document.getElementById(timerFrameId);

  timer.className = "inactive " + timerId;
  timerFrame.className = "inactive " + timerFrameId;

  timer.offsetHeight;
}


function toggleBlinkingBuzzerLight(blinking) {
  /*
  If blinking is true, enables the blinking light, else, disables
  the blinking light

  The blinking light turns on when players are able to buzz in
   */

  let blinkingBuzzerLight = document.getElementById("blinking-buzzer-light");

  if (blinking) {
    blinkingBuzzerLight.classList.remove("inactive");
  } else {
    blinkingBuzzerLight.classList.add("inactive");
  }
}


function changeBuzzerLightColor(active, correct) {
  /*
  Enables or disables the buzzer light depending on active, then changes
  it to green or red depending on correct
   */

  let buzzerLight = document.getElementById("buzzer-light");

  if (active) {
    buzzerLight.classList.remove("inactive");
    if (correct) {
      buzzerLight.style.backgroundColor = "#39FF14";
    } else {
      buzzerLight.style.backgroundColor = "red";
    }
  } else {
    buzzerLight.classList.add("inactive");
    buzzerLight.style.backgroundColor = "transparent";
  }
}

function buzz() {
  socket.emit("buzz");
}

function setupPlayerLivefeed(player, screenQuestion) {
  /*
  Organizes the screen so that the clue text is formatted clearly for the
  livefeed to appear on the bottom of the clue screen
   */

  adjustClueFontSize(screenQuestion, true);

  document.getElementById("player-answer").innerHTML = "";
  document
    .getElementById("player-livefeed-wrapper")
    .classList.remove("inactive");
  document.getElementById("player-livefeed-nickname").innerHTML =
    "<u>" + player.nickname.toUpperCase() + "</u><br>";

  document.getElementById("player-livefeed").innerHTML = "";
}

function startAnswerLivefeedInterval() {
  /*
  Starts interval to send the player's answer form to the server as they are typing
   */

  let answerForm = document.getElementById("answer-form");

  answerLivefeedInterval = setInterval(function() {
    socket.emit("answer_livefeed", answerForm.value);
    if (answerForm.value.length > 0) {
      document
        .getElementById("submit-answer-button")
        .classList.remove("inactive");
    }
  }, 100);
}

function submitAnswer() {
  let answer = document.getElementById("answer-form").value;

  // An answer this long can't possibly be correct and is probably just a joke
  // to try to crash the game
  if (answer.length > 50) {
    answer = "";
  }

  clearInterval(answerLivefeedInterval);
  clearTimeout(scrapeAnswerTimeout);

  document.getElementById("submit-answer-button").className =
    "btn btn-danger btn-lg inactive submit-answer-button";

  if (dailyDouble) {
    socket.emit("submit_answer", answer, true);
  } else if (finalJeoparty) {
    socket.emit("submit_final_jeoparty_answer", answer);
  } else {
    socket.emit("submit_answer", answer, false);
  }

  document.getElementById("answer-form").value = "";

  if (finalJeoparty) {
    changeWaitScreen("OTHER PLAYERS");
  } else {
    changeWaitScreen("SCREEN");
  }
}

function displayPlayerAnswer(player, answer, correct) {
  let header;

  if (dailyDouble) {
    // Displays the wager, then the response to show what the stakes are
    header =
      "<u>" +
      player.nickname.toUpperCase() +
      "'S WAGER</u><br>$" +
      numberWithCommas(player.wager) +
      "<br><br>";
    header += "<u>" + player.nickname.toUpperCase() + "'S ANSWER</u><br>";
  } else {
    header = "<u>" + player.nickname.toUpperCase() + "'S ANSWER</u><br>";
  }

  document.getElementById("clue-text").className = "clue-text";
  document.getElementById("clue-text").innerHTML = header;

  let playerAnswer = document.getElementById("player-answer");
  playerAnswer.classList.remove("inactive");
  playerAnswer.innerHTML = answer.toUpperCase();

  document.getElementById("player-livefeed-wrapper").classList.add("inactive");
  document.getElementById("player-livefeed-nickname").innerHTML = "";

  // Determine how long it takes for the answer's color to change from white to red or green
  playerAnswer.style.transitionDuration = "2s";

  // After one second, reveals the answer to be correct or false by changing the
  // answer's color to either green or red respectively
  setTimeout(function() {
    if (correct) {
      playAudio("applause");
      playerAnswer.style.color = "#39FF14";
    } else {
      playAudio("aww");
      playerAnswer.style.color = "red";
    }
  }, 1000);
}

function getRandomAnswerIntro() {
  /*
  Returns a random string from intros for the text to speech say before
  stating the correct answer to the clue. A full text to speech statement
  would sound like, "The correct answer is something"
   */

  let intros = [
    "The correct answer is ",
    "The correct response is",
    "The answer is ",
    "The answer we were looking for is ",
    "The response we were looking for is ",
    "How about "
  ];

  let intro = intros[Math.floor(Math.random() * intros.length)];

  return intro;
}

function displayCorrectAnswer(correctAnswer) {
  /*
  Displays the correct answer to the clue on screen
   */

  document.getElementById("clue-text").className = "clue-text";
  document.getElementById("clue-text").innerHTML =
    "<u>CORRECT ANSWER</u><br>";

  let playerAnswer = document.getElementById("player-answer");
  playerAnswer.classList.remove("inactive");
  playerAnswer.style.transitionDuration = "0s";
  playerAnswer.style.color = "white";
  playerAnswer.innerHTML = correctAnswer.toUpperCase();
}

function clearLastPlayerAnswer() {
  /*
  Deactivates and empties the text inside of the player-answer element
   */

  let playerAnswer = document.getElementById("player-answer");
  playerAnswer.className = "inactive clue-text";
  playerAnswer.innerHTML = "";
  playerAnswer.style.color = "white";
}

function resetClueButtons() {
  /*
  Unhighlights any board buttons that were highlighted
   */

  // Player's wrapper variables may still be undefined
  try {
    document
      .getElementById(lastCategoryWrapperId)
      .classList.remove("highlighted");
    document.getElementById(lastPriceWrapperId).classList.remove("highlighted");
  } catch (e) {
    // In case lastCategoryWrapperId and/or lastPriceWrapperId are undefined
  }
}

function updateScoreboard(players) {
  /*
  Updates the HTML elements of the scoreboard to reflect the new scores
  and/or positions of each player
   */

  let clone = JSON.parse(JSON.stringify(players));

  let playersLength = Object.keys(clone).length;

  let podiumOne = document.getElementById("podium-1");
  let podiumTwo = document.getElementById("podium-2");
  let podiumThree = document.getElementById("podium-3");
  let overflowRow = document.getElementById("overflow-row");
  let overflow = document.getElementById("overflow-text");

  overflowRow.className = "inactive row overflow-row";
  overflow.innerHTML = "";

  // Only shows as many podiums as there are players in the game or all 3
  // and a text element on the bottom if the screen if there are more than 3
  // Display the top 3 players in the game in "track podium" style. First in the
  // middle, second on the left, and third on the right
  if (playersLength <= 1) {
    podiumOne.className = "col-12";
    podiumTwo.className = "inactive";
    podiumThree.className = "inactive";
  } else if (playersLength == 2) {
    podiumOne.className = "col-6";
    podiumTwo.className = "col-6";
    podiumThree.className = "inactive";
  } else if (playersLength == 3) {
    podiumOne.className = "col-4";
    podiumTwo.className = "col-4";
    podiumThree.className = "col-4";
  } else if (playersLength > 3) {
    overflowRow.classList.remove("inactive");
    let keys = Object.keys(clone);
    keys.sort(function(a, b) {
      return clone[b].score - clone[a].score;
    });

    let newClone = [clone[keys[1]], clone[keys[0]], clone[keys[2]]];
    for (let j = 0; j < playersLength - 3; j++) {
      newClone.push(clone[keys[j + 3]]);
    }
    clone = newClone;
  }

  let i = 1;

  for (let id in clone) {
    // Assigns the top 3 players to the main 3 podiums
    if (i <= 3) {
      let nicknameText = document.getElementById("player-" + i + "-nickname");
      nicknameText.innerHTML = clone[id].nickname.toUpperCase();
      if (clone[id].nickname.length > 15) {
        nicknameText.className = "xs-nickname-text";
      } else if (clone[id].nickname.length > 8) {
        nicknameText.className = "s-nickname-text";
      } else {
        nicknameText.className = "nickname-text";
      }

      let scoreText = document.getElementById("player-" + i + "-score-text");
      // Changes the score to be negative and red if it is beneath 0
      if (clone[id].score < 0) {
        scoreText.innerHTML = "-$" + numberWithCommas(Math.abs(clone[id].score));
        scoreText.style.color = "red";
      } else {
        scoreText.innerHTML = "$" + numberWithCommas(clone[id].score);
        scoreText.style.color = "white";
      }

      // Clears the score screen canvas and redraws the new signature onto it
      let signatureCanvas = document.getElementById(
        "player-" + i + "-signature-canvas"
      );
      let ctx = signatureCanvas.getContext("2d");
      let signature = new Image();

      signature.onload = function() {
        signatureCanvas.width = signatureCanvas.width;

        // Draw color
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 250, 250);

        // Set composite mode
        ctx.globalCompositeOperation = "destination-in";

        // Draw image
        ctx.drawImage(signature, 0, 0);
      };
      signature.src = clone[id].signature;
    } else if (i <= 6) {
      // Lists the next 3 players like "Nickname: $XXX ... " for each one
      overflow.innerHTML += clone[id].nickname.toUpperCase() + ": ";
      if (clone[id].score < 0) {
        overflow.innerHTML +=
          "<span class='red-overflow-text'>-$" +
          Math.abs(clone[id].score) +
          "</span>";
      } else {
        overflow.innerHTML += "$" + clone[id].score;
      }
      // Stops adding a " ... " if no players follow this one
      if (i < 6 && (i != playersLength)) {
        overflow.innerHTML += " ... ";
      }
    }
    i++;
  }
}

function setDoubleJeopartyPriceText() {
  /*
  Change the dollar value text on each board scree to show the doubled amounts
  available in double jeoparty
   */

  doubleJeoparty = true;

  let priceText;

  if (isHost) {
    for (let i = 1; i <= 6; i++) {
      for (let j = 1; j <= 5; j++) {
        priceText = document.getElementById(
          "category-" + i + "-price-" + j + "-text"
        );
        priceText.innerHTML = "$" + j * 400;
      }
    }
  } else {
    for (let i = 1; i <= 5; i++) {
      priceText = document.getElementById("price-" + i + "-text");
      if (i * 400 == 1200) {
        priceText.innerHTML = "$1.2K";
      } else if (i * 400 == 1600) {
        priceText.innerHTML = "$1.6K";
      } else if (i * 400 == 2000) {
        priceText.innerHTML = "2K";
      } else {
        priceText.innerHTML = "$" + i * 400;
      }
    }
  }
}

function changeTimerHeight(half) {
  /*
  If half, decreases the size of the host's timer to half of its normal height,
  else returns the timer height to its normal height

  This is to allow the rest of the scoreboard to be visible while the timer
  is on screen
   */

  let newHeight;

  if (half) {
    newHeight = "5vh";
  } else {
    newHeight = "10vh";
  }

  document.getElementById("h-timer").style.height = newHeight;
  document.getElementById("h-timer-frame").style.height = newHeight;
  for (let i = 1; i <= 8; i++) {
    document.getElementById("divider-" + i).style.height = newHeight;
  }
}

function getRandomFinalJeopartyIntro() {
  /*
  Returns a random string from intros for the text to speech say before
  introducing the final jeoparty category. A full text to speech statement
  would sound like, "The final jeopardy category is..."
   */

  let intros = ["The final je-party category is "];

  let intro = intros[Math.floor(Math.random() * intros.length)];

  return intro;
}

function displayFinalJeopartyCategory(categoryName, categoryDate) {
  /*
  Displays the final jeoparty category's name on screen by itself
   */

  let clueText = document.getElementById("clue-text");
  clueText.className = "h-final-jeoparty-category-name";

  clueText.innerHTML =
    categoryName.toUpperCase() +
    "<br>" +
    "<span class='date-text-color'>(" +
    categoryDate +
    ")</span>";
}

function displayFinalJeopartyAnswers(players) {
  /*
  Displays the final jeoparty answers of each player who submitted one
  before revealing the correct answer and ending the game
   */

  let clone = JSON.parse(JSON.stringify(players));

  let keys = Object.keys(clone);

  // Sorts the list of final jeoparty players from least to greatest score
  keys.sort(function(a, b) {
    return clone[a].score - clone[b].score;
  });

  let playerIds = keys;

  let clueText = document.getElementById("clue-text");
  clueText.classList = "clue-text";
  let playerAnswer = document.getElementById("player-answer");
  playerAnswer.className = "player-answer";

  let i = 0;

  displayEachFinalJeopartyAnswer();

  function displayEachFinalJeopartyAnswer() {
    let nickname, wager, answer, correct;

    nickname = players[playerIds[i]].nickname.toUpperCase();
    wager = players[playerIds[i]].wager;
    answer = players[playerIds[i]].answer.toUpperCase();
    correct = players[playerIds[i]].correct;

    clueText.innerHTML =
      "<u>" + nickname + "'S WAGER</u><br>$" + numberWithCommas(wager) + "<br><br>";
    clueText.innerHTML += "<u>" + nickname + "'S ANSWER</u><br>";

    playerAnswer.style.transitionDuration = "0s";
    playerAnswer.style.color = "white";
    playerAnswer.innerHTML = answer;

    setTimeout(function() {
      playerAnswer.style.transitionDuration = "2s";
      if (correct) {
        playAudio("applause");
        playerAnswer.style.color = "#39FF14";
      } else {
        playAudio("aww");
        playerAnswer.style.color = "red";
      }
    }, 1000);

    i++;

    if (i == playerIds.length) {
      setTimeout(function() {
        endGame(nickname);
      }, 5000);
    } else {
      setTimeout(displayEachFinalJeopartyAnswer, 5000);
    }
  }

  function endGame(nickname) {
    /*
    Shows the correct final jeoparty answer, then congratulates the
    winning player by showing their nickname on screen
     */

    socket.emit("request_players");

    let correctAnswer = finalJeopartyClue["screen_answer"].toUpperCase();

    clueText.innerHTML = "<u>CORRECT ANSWER</u><br>";

    playerAnswer.style.transitionDuration = "0s";
    playerAnswer.style.color = "white";
    playerAnswer.innerHTML = correctAnswer;

    say(getRandomAnswerIntro() + correctAnswer, 0.5);

    setTimeout(function() {
      changeScreen("score-screen");

      setTimeout(function() {
        updateScoreboard(players);
      }, 1000);

      setTimeout(function() {
        changeScreen("clue-screen");
        clearLastPlayerAnswer();
        clueText.innerHTML = "CONGRATULATIONS<br>" + nickname + "!";
        playAudio("big_applause");

        setTimeout(function() {
          clueText.className = "s-clue-text";
          clueText.innerHTML =
            "<u>SPECIAL THANKS TO</u><br>MATT MORNINGSTAR<br>MAX THOMSEN<br>MATT BALDWIN<br>PRANIT NANDA<br>AKA 'THE JEOPARTY COUNCIL'";
          playAudio("landing_screen_theme", true);

          setTimeout(function() {
            clueText.className = "clue-text";
            clueText.innerHTML = "THANKS FOR PLAYING!";
            resetGame(false);
            setTimeout(function() {
              socket.emit("reset_all");
            }, 10000);
          }, 20000);
        }, 10000);
      }, 5000);
    }, 5000);
  }
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
