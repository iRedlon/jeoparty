const _ = require('lodash');
const path = require('path');
const express = require('express');
const cookie = require('cookie');
const randomWords = require('random-words');

const Airbrake = require('@airbrake/node');
const airbrakeExpress = require('@airbrake/node/dist/instrumentation/express');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 8080;

let cache = require('memory-cache');
let sessionCache = new cache.Cache();
let disconnectionCache = new cache.Cache();

const Player = require('../constants/Player').Player;
const GameSession = require('../constants/GameSession').GameSession;
const GameState = require('../constants/GameState').GameState;

const api = require('../constants/api').api;
const timers = require('../constants/timers').timers;
const titles = require('../constants/titles').titles;
const getRandomCategories = require('../helpers/categories').getRandomCategories;
const writeCategories = require('../helpers/jservice').writeCategories;
const checkPlayerName = require('../helpers/check').checkPlayerName;
const checkAnswer = require('../helpers/check').checkAnswer;
const formatRaw = require('../helpers/format').formatRaw;
const formatWager = require('../helpers/format').formatWager;
const handleLeaderboardReset = require('../helpers/leaderboard').handleLeaderboardReset;
const getLeaderboards = require('../helpers/leaderboard').getLeaderboards;
// const resetLeaderboard = require('../helpers/leaderboard').resetLeaderboard;
const updateLeaderboard = require('../helpers/leaderboard').updateLeaderboard;

const airbrake = new Airbrake.Notifier({
    projectId: process.env.AIRBRAKE_PROJECT_ID || api.AIRBRAKE_PROJECT_ID,
    projectKey: process.env.AIRBRAKE_PROJECT_KEY || api.AIRBRAKE_PROJECT_KEY
});

const STARTING_DECADE = 2000;
const NUM_CATEGORIES = 6;
const NUM_CLUES = 5;

// app.use((req, res, next) => {
//     if (req.header('x-forwarded-proto') !== 'https') {
//         res.redirect(`https://${req.header('host')}${req.url}`);
//     } else {
//         next();
//     }
// });

app.use(airbrakeExpress.makeMiddleware(airbrake));
app.use(express.static(path.join(__dirname, '../../build')));
app.get('/', (req, res, next) => res.sendFile(__dirname + './index.html'));
app.use(airbrakeExpress.makeErrorHandler(airbrake));

// Session cache helpers

const updateGameSession = (sessionName, key, value) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);
    gameSession[key] = value;
    sessionCache.put(sessionName, gameSession);
};

const updateClients = (sessionName, socket) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);
    let clients = gameSession.clients;

    clients.push(socket);
    gameSession.clients = clients;
    sessionCache.put(sessionName, gameSession);
};

const getClient = (sessionName, socketId) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    for (let i = 0; i < gameSession.clients.length; i++) {
        const client = gameSession.clients[i];

        if (client.id === socketId) {
            return client;
        }
    }

    return null;
};

const createNewPlayer = (sessionName, socketId) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);
    let players = gameSession.players;

    players[socketId] = new Player();
    players[socketId].sessionName = sessionName;
    players[socketId].socketId = socketId;
    players[socketId].joinIndex = _.size(players);

    gameSession.players = players;
    sessionCache.put(sessionName, gameSession);
};

const updatePlayer = (sessionName, socketId, key, value) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);
    let players = gameSession.players;

    if (_.get(players, `[${socketId}]`)) {
        players[socketId][key] = value;

        gameSession.players = players;
        sessionCache.put(sessionName, gameSession);
    }
};

const handleRandomCategoriesResults = (sessionName, decade, categories, doubleJeopartyCategories, finalJeopartyClue, error) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    if (error) {
        gameSession.browserClient.emit('alert', `We stalled out trying to generate categories! Please refresh the page and try again.`);
        return;
    }

    // Prevent a completed old request from overwriting a more recent request for new categories
    if (decade === gameSession.decade) {
        updateGameSession(sessionName, 'categories', categories);
        updateGameSession(sessionName, 'doubleJeopartyCategories', doubleJeopartyCategories);
        updateGameSession(sessionName, 'finalJeopartyClue', finalJeopartyClue);

        updateGameSession(sessionName, 'categoriesLoaded', true);
        gameSession.browserClient.emit('categories_loaded', true);
    }
};

const setOldScores = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    _.keys(gameSession.players).map((socketId) => {
        const score = _.get(gameSession, `players[${socketId}].score`, 0);

        updatePlayer(sessionName, socketId, 'oldScore', score);
    });
};

const updatePlayerScore = (sessionName, socketId, value, isCorrect) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);

    if (_.get(gameSession.players, `[${socketId}]`)) {
        const newScore = _.get(gameSession.players, `[${socketId}].score`, 0) + (isCorrect ? value : -value);
        updatePlayer(sessionName, socketId, 'score', newScore);
    }
};

const updatePlayerStreak = (sessionName, socket, isCorrect) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    const streak = _.get(gameSession, `players[${socket.id}].streak`, 0);

    if (isCorrect) {
        updatePlayer(socket.sessionName, socket.id, 'streak', streak + 1);
        updatePlayer(socket.sessionName, socket.id, 'heat', 2);
        updatePlayer(socket.sessionName, socket.id, 'title', titles[streak + 1]);
    } else {
        updatePlayer(socket.sessionName, socket.id, 'streak', 0);
        updatePlayer(socket.sessionName, socket.id, 'heat', 0);
        updatePlayer(socket.sessionName, socket.id, 'title', '');
    }
};

const decrementPlayerHeat = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    for (let socketId of _.keys(gameSession.players)) {
        const heat = _.get(gameSession, `players[${socketId}].heat`, 0);

        if (!gameSession.playersAnswered.includes(socketId)) {
            updatePlayer(sessionName, socketId, 'heat', Math.max(0, heat - 1));

            if (heat - 1 === 0) {
                updatePlayer(sessionName, socketId, 'streak', 0);
                updatePlayer(sessionName, socketId, 'title', '');
            }
        }
    }
};

const updatePlayersAnswered = (sessionName, socketId) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);

    let playersAnswered = gameSession.playersAnswered;
    playersAnswered.push(socketId);
    gameSession.playersAnswered = playersAnswered;

    sessionCache.put(sessionName, gameSession);
};

const updateCategories = (sessionName, categoryIndex, clueIndex) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    let gameSession = sessionCache.get(sessionName);
    let categories = gameSession.categories;

    categories[categoryIndex].clues[clueIndex].completed = true;
    categories[categoryIndex].numCluesUsed = categories[categoryIndex].numCluesUsed + 1;

    if (categories[categoryIndex].numCluesUsed === NUM_CLUES) {
        categories[categoryIndex].completed = true;
    }

    gameSession.categories = categories;

    sessionCache.put(sessionName, gameSession);
};

const handleBrowserDisconnection = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    gameSession.clients.map((client) => {
        client.emit('reload');
    });

    sessionCache.del(sessionName);
};

const handlePlayerDisconnection = (sessionName, socket) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const player = _.get(sessionCache.get(sessionName), `players[${socket.id}]`);

    // Only 'remember' this player if they've submitted their name/signature already
    if (player && !_.isEmpty(player.name)) {
        const playerId = `${sessionName}-${socket.id}`;

        // DEBUG
        // console.log('handlePlayerDisconnection');
        // console.log('success!');
        // console.log(`player id: ${playerId}`);
        // console.log(`player name: ${player.name}`);
        // console.log('------------------------');

        const RECONNECT_WINDOW = 15 * 60 * 1000;
        disconnectionCache.put(playerId, sessionCache.get(sessionName).players[socket.id], RECONNECT_WINDOW);

        let gameSession = sessionCache.get(sessionName);
        let players = gameSession.players;

        delete players[socket.id];

        if (_.isEmpty(players)) {
            gameSession.browserClient.disconnect(true);
            return;
        }

        gameSession.players = players;
        sessionCache.put(sessionName, gameSession);

        if (gameSession.currentGameState === GameState.LOBBY) {
            gameSession.browserClient.emit('players', gameSession.players);
        } else if (gameSession.currentGameState === GameState.BOARD && socket.id === gameSession.boardController.id) {
            showBoard(socket.sessionName);
        }
    }
};

const handlePlayerReconnection = (socket) => {
    const cookies = cookie.parse(_.get(socket, 'handshake.headers.cookie', ''));
    const playerId = _.get(cookies, '[player-id]', '');
    const player = disconnectionCache.get(playerId);

    if (player && sessionCache.get(player.sessionName)) {
        // DEBUG
        // console.log('handlePlayerReconnection');
        // console.log('success!');
        // console.log(`player id: ${playerId}`);
        // console.log(`player name: ${player.name}`);
        // console.log('------------------------');

        const sessionName = player.sessionName;
        let gameSession = sessionCache.get(sessionName);

        // If this player has already answered the current clue then they shouldn't be allowed to answer again
        if (gameSession.playersAnswered.includes(player.socketId)) {
            let playersAnswered = gameSession.playersAnswered;
            playersAnswered.push(socket.id);
            gameSession.playersAnswered = playersAnswered;
        }

        player.socketId = socket.id;
        player.streak = 0;
        player.heat = 0;
        player.title = '';

        let players = gameSession.players;
        players[socket.id] = player;
        gameSession.players = players;

        let clients = gameSession.clients;
        clients.push(socket);
        gameSession.clients = clients;

        sessionCache.put(sessionName, gameSession);

        socket.sessionName = sessionName;

        disconnectionCache.del(socket.handshake.address);

        socket.emit('set_game_state', sessionCache.get(socket.sessionName).currentGameState, () => {
            socket.emit('reconnect');
            socket.emit('set_cookie', player);
            socket.emit('player', player);
        });

        if (gameSession.currentGameState === GameState.LOBBY) {
            gameSession.browserClient.emit('players', gameSession.players);
        }
    }
};

// Gameplay helpers

const checkBoardCompletion = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    setOldScores(sessionName);

    for (let i = 0; i < NUM_CATEGORIES; i++) {
        for (let j = 0; j < NUM_CLUES; j++) {
            const clue = _.get(gameSession, `categories[${i}].clues[${j}]`, {});

            if (!clue.completed) {
                updateGameSession(sessionName, 'categoryIndex', null);
                updateGameSession(sessionName, 'clueIndex', null);
                updateGameSession(sessionName, 'buzzInTimeout', false);
                updateGameSession(sessionName, 'playersAnswered', []);

                return false;
            }
        }
    }

    if (gameSession.doubleJeoparty) {
        // All double jeoparty clues are completed, kick off final jeoparty
        updateGameSession(sessionName, 'finalJeoparty', true);
        return true;
    } else {
        // All clues are completed, reset for double jeoparty
        const doubleJeopartyCategories = gameSession.doubleJeopartyCategories;
        updateGameSession(sessionName, 'categories', doubleJeopartyCategories);
        updateGameSession(sessionName, 'doubleJeoparty', true);
        updateGameSession(sessionName, 'boardRevealed', false);

        const sortedPlayers = _.cloneDeep(_.values(gameSession.players).sort((a, b) => b.score - a.score));
        updateGameSession(sessionName, 'boardController', getClient(sessionName, sortedPlayers[sortedPlayers.length - 1].socketId));
    }
};

const resetPlayerAnswers = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    for (let socketId of _.keys(gameSession.players)) {
        updatePlayer(sessionName, socketId, 'isCorrect', false);
        updatePlayer(sessionName, socketId, 'answer', '');
    }
};

const checkBoardController = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    if (!_.get(gameSession.players, `[${gameSession.boardController.id}]`)) {
        const newBoardController = getClient(sessionName, _.keys(gameSession.players)[Math.floor(Math.random() * _.size(gameSession.players))]);

        updateGameSession(sessionName, 'boardController', newBoardController);
    }
};

const showBoard = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);
    const finalJeoparty = checkBoardCompletion(sessionName);

    resetPlayerAnswers(sessionName);

    if (finalJeoparty) {
        const numFinalJeopartyPlayers = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0;
        })).length;

        if (numFinalJeopartyPlayers > 0) {
            showWager(sessionName);
        } else {
            showPodium(sessionName, { name: 'the friends we made along the way' });
        }

        return;
    }

    checkBoardController(sessionName);

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.BOARD, () => {
            client.emit('categories', gameSession.categories, gameSession.doubleJeoparty);
            client.emit('say_board_introduction', _.get(gameSession, `players[${gameSession.boardController.id}].name`, ''), gameSession.boardRevealed, gameSession.categories, gameSession.doubleJeoparty);
            client.emit('is_board_controller', client.id === gameSession.boardController.id, gameSession.boardRevealed);
            client.emit('player', _.get(gameSession, `players[${client.id}]`));
        });
    });

    updateGameSession(sessionName, 'currentGameState', GameState.BOARD);
};

const showWager = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    const totalWagers = _.keys(_.values(gameSession.players).filter((player) => {
        return player.oldScore > 0;
    })).length;

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.WAGER, () => {
            if (gameSession.finalJeoparty) {
                client.emit('final_jeoparty_clue', gameSession.finalJeopartyClue);
                client.emit('wagers_submitted', 0, totalWagers);
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
            } else {
                const boardController = _.get(gameSession, `players[${gameSession.boardController.id}]`);

                client.emit('board_controller', boardController, Math.max(_.get(boardController, 'score', 0), gameSession.doubleJeoparty ? 2000 : 1000));
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
            }
        });
    });

    updateGameSession(sessionName, 'currentGameState', GameState.WAGER);
};

const submitWager = (socket, wager) => {
    if (!sessionCache.get(socket.sessionName) || sessionCache.get(socket.sessionName).currentGameState !== GameState.WAGER) {
        return;
    }

    const gameSession = sessionCache.get(socket.sessionName);

    updatePlayerWager(socket, wager);

    if (gameSession.finalJeoparty) {
        updatePlayer(socket.sessionName, socket.id, 'finalJeopartyWagerSubmitted', true);

        const currentWagersSubmitted = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0 && player.finalJeopartyWagerSubmitted;
        })).length;

        const totalWagers = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0;
        })).length;

        if (currentWagersSubmitted === totalWagers) {
            showClue(socket.sessionName, true);
        } else {
            gameSession.browserClient.emit('wagers_submitted', currentWagersSubmitted, totalWagers);
        }
    } else {
        showClue(socket.sessionName, true);
    }
};

const updatePlayerWager = (socket, wager) => {
    if (!sessionCache.get(socket.sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(socket.sessionName);

    const score = _.get(gameSession, `players[${socket.id}].score`, 0);
    const min = gameSession.finalJeoparty ? 0 : 5;
    const max = gameSession.finalJeoparty ? score : Math.max(score, gameSession.doubleJeoparty ? 2000 : 1000);
    updatePlayer(socket.sessionName, socket.id, 'wager', formatWager(wager, min, max));
};

const showClue = (sessionName, sayClueText) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);
    const clue = gameSession.finalJeoparty ? gameSession.finalJeopartyClue : _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, {});

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.CLUE, () => {
            client.emit('clue_text', clue.question);
            client.emit('say_clue_text', clue.question, clue.dailyDouble, gameSession.finalJeoparty, sayClueText);
            client.emit('has_answered', clue.dailyDouble || gameSession.finalJeoparty || gameSession.playersAnswered.includes(client.id));
            client.emit('player', _.get(gameSession, `players[${client.id}]`));
        });
    });

    updateGameSession(sessionName, 'currentGameState', GameState.CLUE);
};

const buzzIn = (socket) => {
    if (!sessionCache.get(socket.sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(socket.sessionName);

    if (gameSession.buzzInTimeout) {
        updateGameSession(socket.sessionName, 'buzzInTimeout', false);

        const clue = gameSession.finalJeoparty ? gameSession.finalJeopartyClue : _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, {});
        const categoryName = gameSession.finalJeoparty ? gameSession.finalJeopartyClue.categoryName : _.get(gameSession, `categories[${gameSession.categoryIndex}].title`, '');
        const categoryYear = gameSession.finalJeoparty ? gameSession.finalJeopartyClue.year.toString() : _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[0].airdate`, '').slice(0, 4);
        const dollarValue = clue.dailyDouble ? _.get(gameSession, `players[${socket.id}].wager`, 0) : (gameSession.doubleJeoparty ? 400 : 200) * (gameSession.clueIndex + 1);

        const currentAnswersSubmitted = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0 && player.finalJeopartyAnswerSubmitted;
        })).length;

        const totalAnswers = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0;
        })).length;

        gameSession.clients.map((client) => {
            client.emit('set_game_state', GameState.ANSWER, () => {
                const oldScore = _.get(gameSession, `players[${client.id}].oldScore`, 0);

                client.emit('request_clue', categoryName, categoryYear, clue.question, dollarValue, gameSession.finalJeoparty);
                client.emit('play_buzz_in_sound', clue.dailyDouble, gameSession.finalJeoparty);
                client.emit('player_name', _.get(gameSession, `players[${socket.id}].name`, ''));
                client.emit('answers_submitted', currentAnswersSubmitted, totalAnswers);
                client.emit('is_answering', gameSession.finalJeoparty ? oldScore > 0 : client.id === socket.id, gameSession.finalJeoparty);
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
            });
        });

        updateGameSession(socket.sessionName, 'currentGameState', GameState.ANSWER);

        setTimeout(() => {
            if (!sessionCache.get(socket.sessionName)) {
                return;
            }

            const gameSession = sessionCache.get(socket.sessionName);

            if (gameSession.finalJeoparty) {
                gameSession.clients.map((client) => {
                    const oldScore = _.get(gameSession, `players[${client.id}].oldScore`, 0);

                    if (oldScore > 0) {
                        submitAnswer(client, _.get(gameSession, `players[${client.id}].answer`, ''), true);
                    }
                });
            } else {
                submitAnswer(socket, _.get(gameSession, `players[${socket.id}].answer`, ''), true);
            }
        }, (gameSession.finalJeoparty ? timers.FINAL_JEOPARTY_ANSWER_TIMEOUT : timers.ANSWER_TIMEOUT) * 1000);
    }
};

const startTimer = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    io.to(sessionName).emit('start_timer');

    updateGameSession(sessionName, 'buzzInTimeout', true);

    setTimeout(() => {
        if (!sessionCache.get(sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(sessionName);

        if (gameSession.buzzInTimeout) {
            const correctAnswer = sessionCache.get(sessionName).categories[gameSession.categoryIndex].clues[gameSession.clueIndex].answer;
            showCorrectAnswer(sessionName, correctAnswer, true, true);
        }
    }, timers.BUZZ_IN_TIMEOUT * 1000);
};

const submitAnswer = (socket, answer, timeout) => {
    if (!sessionCache.get(socket.sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(socket.sessionName);

    if (!gameSession.finalJeoparty && gameSession.playersAnswered.includes(socket.id)) {
        return;
    }

    const categoryName = gameSession.finalJeoparty ? gameSession.finalJeopartyClue.categoryName :_.get(gameSession, `categories[${gameSession.categoryIndex}].title`, '');
    const clue = gameSession.finalJeoparty ? gameSession.finalJeopartyClue : _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, { 'question': '', 'answer': ''});

    const isCorrect = checkAnswer(categoryName, clue.question, clue.answer, answer);
    const dollarValue = clue.dailyDouble || gameSession.finalJeoparty ? _.get(gameSession, `players[${socket.id}].wager`, 0) : (gameSession.doubleJeoparty ? 400 : 200) * (gameSession.clueIndex + 1);

    if (!gameSession.finalJeoparty || (gameSession.finalJeoparty && !_.get(gameSession, `players[${socket.id}].finalJeopartyAnswerSubmitted`, false))) {
        updatePlayersAnswered(socket.sessionName, socket.id);
        updatePlayerScore(socket.sessionName, socket.id, dollarValue, isCorrect);
    }

    if (gameSession.finalJeoparty) {
        updatePlayer(socket.sessionName, socket.id, 'finalJeopartyAnswerSubmitted', true);
        updatePlayer(socket.sessionName, socket.id, 'answer', answer);

        const currentAnswersSubmitted = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0 && player.finalJeopartyAnswerSubmitted;
        })).length;

        const totalAnswers = _.keys(_.values(gameSession.players).filter((player) => {
            return player.oldScore > 0;
        })).length;

        if (currentAnswersSubmitted === totalAnswers && timeout && gameSession.currentGameState !== GameState.DECISION) {
            showFinalJeopartyDecision(socket.sessionName);
        } else {
            gameSession.browserClient.emit('answers_submitted', currentAnswersSubmitted, totalAnswers);
        }

        return;
    }

    updatePlayer(socket.sessionName, socket.id, 'isCorrect', isCorrect);
    updatePlayerStreak(socket.sessionName, socket, isCorrect);

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.DECISION, () => {
            client.emit('show_answer', answer, _.get(gameSession, `players[${socket.id}].name`, ''));
            client.emit('player', _.get(gameSession, `players[${client.id}]`));
            client.emit('show_new_score', client.id !== socket.id);
        });
    });

    updateGameSession(socket.sessionName, 'currentGameState', GameState.DECISION);

    setTimeout(() => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        gameSession.browserClient.emit('show_decision', isCorrect, dollarValue);
        gameSession.clients.map((client) => {
            client.emit('show_new_score', true);
        });
    }, timers.SHOW_PRE_DECISION_TIME * 1000);
};

const showFinalJeopartyDecision = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    const totalAnswers = _.keys(_.values(gameSession.players).filter((player) => {
        return player.oldScore > 0;
    })).length;

    const sortedPlayers = _.cloneDeep(_.values(gameSession.players).filter((player) => {
        return player.oldScore > 0;
    }).sort((a, b) => {
        return a.name.localeCompare(b.name);
    }));

    if (gameSession.finalJeopartyDecisionIndex < totalAnswers) {
        const player = sortedPlayers[gameSession.finalJeopartyDecisionIndex];

        gameSession.clients.map((client) => {
            client.emit('set_game_state', GameState.DECISION, () => {
                client.emit('show_answer', player.answer, player.name);
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
                client.emit('show_new_score', client.id !== player.socketId);
            });
        });

        updateGameSession(sessionName, 'currentGameState', GameState.DECISION);
        updateGameSession(sessionName, 'finalJeopartyDecisionIndex', gameSession.finalJeopartyDecisionIndex + 1);

        setTimeout(() => {
            if (!sessionCache.get(sessionName)) {
                return;
            }

            const isCorrect = checkAnswer(gameSession.finalJeopartyClue.categoryName, gameSession.finalJeopartyClue.question, gameSession.finalJeopartyClue.answer, player.answer);

            gameSession.browserClient.emit('show_decision', isCorrect, player.wager);
            getClient(sessionName, player.socketId).emit('show_new_score', true);
        }, timers.SHOW_PRE_DECISION_TIME * 1000);
    } else {
        showCorrectAnswer(sessionName, gameSession.finalJeopartyClue.answer, false, true);
    }
};

const showCorrectAnswer = (sessionName, correctAnswer, timeout, sayCorrectAnswer) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);

    if (timeout && _.isEmpty(gameSession.playersAnswered)) {
        gameSession.clients.map((client) => {
            client.emit('set_game_state', GameState.DECISION, () => {
                client.emit('show_correct_answer', correctAnswer, sayCorrectAnswer, true, timeout);
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
            });
        });

        updateGameSession(sessionName, 'currentGameState', GameState.DECISION);
    } else {
        gameSession.clients.map((client) => {
            client.emit('set_game_state', GameState.DECISION, () => {
                client.emit('show_correct_answer', correctAnswer, sayCorrectAnswer, false, timeout);
                client.emit('player', _.get(gameSession, `players[${client.id}]`));
            });
        });

        updateGameSession(sessionName, 'currentGameState', GameState.DECISION);

        if (!sayCorrectAnswer) {
            setTimeout(() => {
                if (!sessionCache.get(sessionName)) {
                    return;
                }

                showScoreboard(sessionName);
            }, timers.SHOW_CORRECT_ANSWER_TIME * 1000);
        }
    }
};

const showScoreboard = (sessionName) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    decrementPlayerHeat(sessionName);

    const gameSession = sessionCache.get(sessionName);

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.SCOREBOARD, () => {
            client.emit('players', gameSession.players);
            client.emit('player', _.get(gameSession, `players[${client.id}]`));
        });
    });

    updateGameSession(sessionName, 'currentGameState', GameState.SCOREBOARD);

    if (!_.isEmpty(gameSession.playersAnswered)) {
        setTimeout(() => {
            if (!sessionCache.get(sessionName)) {
                return;
            }

            gameSession.browserClient.emit('show_update', gameSession.players);
        }, timers.SHOW_SCOREBOARD_PRE_UPDATE_TIME * 1000);
    }
};

const showPodium = (sessionName, championOverride) => {
    if (!sessionCache.get(sessionName)) {
        return;
    }

    const gameSession = sessionCache.get(sessionName);
    const champion = _.values(gameSession.players).sort((a, b) => b.score - a.score)[0];

    gameSession.clients.map((client) => {
        client.emit('set_game_state', GameState.PODIUM, () => {
            client.emit('champion', championOverride || champion);
            client.emit('player', _.get(gameSession, `players[${client.id}]`));
        });
    });

    updateLeaderboard(gameSession.players);
};

io.on('connection', (socket) => {
    airbrake.addFilter((notice) => {
        if (socket.sessionName) {
            notice.params = { session: sessionCache.get(socket.sessionName) };
        }

        return notice;
    });

    socket.emit('connect_device');

    socket.on('connect_device', async (isMobile) => {
        socket.isMobile = isMobile;

        if (isMobile) {
            handlePlayerReconnection(socket);
        } else {
            const sessionName = randomWords({exactly: 1, maxLength: 5})[0];
            let session = new GameSession();

            socket.sessionName = sessionName;
            socket.join(sessionName);

            sessionCache.put(sessionName, session);
            updateGameSession(sessionName, 'browserClient', socket);
            updateClients(sessionName, socket);

            socket.emit('session_name', sessionName);
            socket.emit('active_players', sessionCache.keys().length - 1);

            if (process.env.AIRBRAKE_PROJECT_ID) {
                handleLeaderboardReset().then(() => {
                    getLeaderboards().then((leaderboards) => {
                        socket.emit('leaderboards', leaderboards);
                    });
                });
            } else {
                getLeaderboards().then((leaderboards) => {
                    socket.emit('leaderboards', leaderboards);
                });
            }

            // writeCategories(STARTING_DECADE, (categories, doubleJeopartyCategories, finalJeopartyClue, error) => {
            //     handleRandomCategoriesResults(sessionName, STARTING_DECADE, categories, doubleJeopartyCategories, finalJeopartyClue, error);
            // });

            getRandomCategories(STARTING_DECADE, (categories, doubleJeopartyCategories, finalJeopartyClue, error) => {
                handleRandomCategoriesResults(sessionName, STARTING_DECADE, categories, doubleJeopartyCategories, finalJeopartyClue, error);
            });
        }
    });

    socket.on('unmute', () => {
        socket.emit('unmute');
    });

    socket.on('join_session', (sessionName) => {
        sessionName = formatRaw(sessionName);

        if (sessionCache.get(sessionName)) {
            socket.sessionName = sessionName;
            socket.join(sessionName);
            updateClients(sessionName, socket);

            createNewPlayer(sessionName, socket.id);

            if (!sessionCache.get(socket.sessionName).boardController) {
                updateGameSession(socket.sessionName, 'boardController', socket);
            }

            socket.emit('join_session_success');
        } else {
            socket.emit('join_session_failure', sessionName);
        }
    });

    socket.on('submit_signature', (playerName, signature) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        const checkPlayerMessage = checkPlayerName(playerName, signature);

        if (_.isEmpty(checkPlayerMessage)) {
            updatePlayer(socket.sessionName, socket.id, 'name', playerName);
            updatePlayer(socket.sessionName, socket.id, 'signature', signature);

            socket.emit('submit_signature_success', _.get(gameSession, `players[${socket.id}]`));
            gameSession.browserClient.emit('players', gameSession.players);
        } else {
            socket.emit('submit_signature_failure', checkPlayerMessage);
        }
    });

    socket.on('decade', (decade) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        if (gameSession.categoriesLoaded) {
            updateGameSession(socket.sessionName, 'decade', decade);
            updateGameSession(socket.sessionName, 'categoriesLoaded', false);

            getRandomCategories(decade, (categories, doubleJeopartyCategories, finalJeopartyClue, error) => {
                handleRandomCategoriesResults(socket.sessionName, decade, categories, doubleJeopartyCategories, finalJeopartyClue, error);
            });
        }
    });

    socket.on('start_game', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        if (!_.isEmpty(sessionCache.get(socket.sessionName).players)) {
            socket.emit('start_game_success');
            showBoard(socket.sessionName);
        } else {
            socket.emit('start_game_failure');
        }
    });

    socket.on('board_revealed', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        updateGameSession(socket.sessionName, 'boardRevealed', true);
        io.to(socket.sessionName).emit('board_revealed', gameSession.doubleJeoparty);
    });

    socket.on('request_clue', (categoryIndex, clueIndex) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        updateGameSession(socket.sessionName, 'categoryIndex', categoryIndex);
        updateGameSession(socket.sessionName, 'clueIndex', clueIndex);

        const gameSession = sessionCache.get(socket.sessionName);
        const categoryName = _.get(gameSession, `categories[${gameSession.categoryIndex}].title`, '');
        const dollarValue = (gameSession.doubleJeoparty ? 400 : 200) * (gameSession.clueIndex + 1);
        const clue = _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, {});

        gameSession.browserClient.emit('request_clue', categoryIndex, clueIndex, clue.dailyDouble);
        gameSession.browserClient.emit('say_clue_request', categoryName, dollarValue, clue.dailyDouble);
        gameSession.browserClient.emit('clue_text', clue.question);

        updateCategories(socket.sessionName, categoryIndex, clueIndex);
    });

    socket.on('say_clue_request', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);
        const clue = _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, {});

        if (clue.dailyDouble) {
            setTimeout(() => {
                if (!sessionCache.get(socket.sessionName)) {
                    return;
                }

                showWager(socket.sessionName);
            }, timers.SHOW_DAILY_DOUBLE_ANIMATION * 1000);
        } else {
            setTimeout(() => {
                if (!sessionCache.get(socket.sessionName)) {
                    return;
                }

                showClue(socket.sessionName, true);
            }, (timers.SHOW_CLUE_ANIMATION * 1000) + 100);
        }
    });

    socket.on('start_timer', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        startTimer(socket.sessionName);
    });

    socket.on('start_wager_timer', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        gameSession.browserClient.emit('start_wager_timer');

        if (gameSession.finalJeoparty) {
            gameSession.clients.map((client) => {
                const oldScore = _.get(gameSession, `players[${client.id}].oldScore`, 0);

                if (oldScore > 0) {
                    client.emit('is_wagering', true);
                }
            });
        } else {
            // Daily double
            gameSession.boardController.emit('is_wagering', true);
        }

        setTimeout(() => {
            if (!sessionCache.get(socket.sessionName)) {
                return;
            }

            const gameSession = sessionCache.get(socket.sessionName);

            if (gameSession.finalJeoparty) {
                gameSession.clients.map((client) => {
                    const oldScore = _.get(gameSession, `players[${client.id}].oldScore`, 0);

                    if (oldScore > 0 && !_.get(gameSession, `players[${client.id}].finalJeopartyWagerSubmitted`, false)) {
                        submitWager(client, _.get(gameSession, `players[${client.id}].wager`, 0));
                    }
                });
            } else {
                // Daily double
                submitWager(gameSession.boardController, _.get(gameSession, `players[${gameSession.boardController.id}].wager`, 0));
            }
        }, timers.WAGER_TIMEOUT * 1000);
    });

    socket.on('wager_livefeed', (wagerLivefeed) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        updatePlayerWager(socket, wagerLivefeed);
        sessionCache.get(socket.sessionName).browserClient.emit('wager_livefeed', wagerLivefeed);
    });

    socket.on('submit_wager', (wager) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        submitWager(socket, wager);
    });

    socket.on('wager_buzz_in', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        updateGameSession(socket.sessionName, 'buzzInTimeout', true);
        buzzIn(gameSession.boardController);
    });

    socket.on('buzz_in', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        buzzIn(socket);
    });

    socket.on('answer_livefeed', (answerLivefeed) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        updatePlayer(socket.sessionName, socket.id, 'answer', answerLivefeed);
        sessionCache.get(socket.sessionName).browserClient.emit('answer_livefeed', answerLivefeed);
    });

    socket.on('submit_answer', (answer) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        submitAnswer(socket, answer, false);
    });

    socket.on('show_decision', (isCorrect) => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        if (gameSession.finalJeoparty) {
            showFinalJeopartyDecision(socket.sessionName);
        } else {
            const clue = _.get(gameSession, `categories[${gameSession.categoryIndex}].clues[${gameSession.clueIndex}]`, {});

            if (isCorrect) {
                const newBoardController = getClient(socket.sessionName, gameSession.playersAnswered[gameSession.playersAnswered.length - 1]);

                updateGameSession(socket.sessionName, 'boardController', newBoardController);
                showCorrectAnswer(socket.sessionName, clue.answer, false, false);
            } else if (_.size(gameSession.playersAnswered) === _.size(gameSession.players) || clue.dailyDouble) {
                showCorrectAnswer(socket.sessionName, clue.answer, false, true);
            } else {
                showClue(socket.sessionName, false);
                startTimer(socket.sessionName);
            }
        }
    });

    socket.on('show_board', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        const gameSession = sessionCache.get(socket.sessionName);

        if (gameSession.finalJeoparty) {
            showPodium(socket.sessionName);
        } else {
            showBoard(socket.sessionName);
        }
    });

    socket.on('show_scoreboard', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        showScoreboard(socket.sessionName);
    });

    socket.on('disconnect', () => {
        if (!sessionCache.get(socket.sessionName)) {
            return;
        }

        if (socket.isMobile) {
            handlePlayerDisconnection(socket.sessionName, socket);
        } else {
            handleBrowserDisconnection(socket.sessionName);
        }
    });
});

server.listen(port);
