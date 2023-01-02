const GameState = require('../constants/GameState').GameState;

function GameSession() {
    this.browserClient = null;
    this.clients = [];

    this.currentGameState = GameState.LOBBY;
    this.doubleJeoparty = false;
    this.finalJeoparty = false;
    this.boardRevealed = false;
    this.finalJeopartyDecisionIndex = 0;

    this.decade = 2000;
    this.categoriesLoaded = false;
    this.categories = [];
    this.doubleJeopartyCategories = [];
    this.finalJeopartyClue = {};

    this.players = {};
    this.playersAnswered = [];
    this.boardController = null;

    this.categoryIndex = null;
    this.clueIndex = null;

    this.buzzInTimeout = false;
}

exports.GameSession = GameSession;
