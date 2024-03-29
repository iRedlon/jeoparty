const _ = require('lodash');

const formatRaw = require('./format').formatRaw;
const formatCategory = require('./format').formatCategory;

const categoriesDB = require('../constants/categoriesDB.js').categoriesDB;
const finalJeopartyClues = require('../constants/finalJeopartyClues.js').finalJeopartyClues;

const MAX_CATEGORY_ID = 18418;
const NUM_CATEGORIES = 6;
const NUM_CLUES = 5;

const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

const weightedRandomClueIndex = () => {
    let sum = 0;
    let r = Math.random();

    const distribution = {0: 0.05, 1: 0.2, 2: 0.4, 3: 0.2, 4: 0.15};

    for (const i in distribution) {
        sum += distribution[i];

        if (r <= sum) {
            return parseInt(i);
        }
    }
};

const getDailyDoubleIndices = () => {
    const categoryIndex = Math.floor(Math.random() * NUM_CATEGORIES);
    const clueIndex = weightedRandomClueIndex();

    const djCategoryIndex1 = Math.floor(Math.random() * NUM_CATEGORIES);
    const djClueIndex1 = weightedRandomClueIndex();

    let djCategoryIndex2;
    do {
        djCategoryIndex2 = Math.floor(Math.random() * NUM_CATEGORIES);
    } while (djCategoryIndex1 === djCategoryIndex2);
    const djClueIndex2 = weightedRandomClueIndex();

    return [categoryIndex, clueIndex, djCategoryIndex1, djClueIndex1, djCategoryIndex2, djClueIndex2];
};

const getRandomCategory = (decade) => {
    const categoryId = Math.floor(Math.random() * MAX_CATEGORY_ID) + 1;

    if (categoryId in categoriesDB) {
        let category = categoriesDB[categoryId];

        const cluesCount = category.clues_count;
        const startingIndex = Math.round((Math.random() * (cluesCount - NUM_CLUES)) / NUM_CLUES) * NUM_CLUES;
        category.clues = category.clues.slice(startingIndex, startingIndex + NUM_CLUES);

        if (approveCategory(category, decade)) {
            return category;
        } else {
            return null;
        }
    } else {
        return null;
    }
};

const approveCategory = (category, decade) => {
    const rawCategoryTitle = formatRaw(category.title);
    const isMediaCategory = rawCategoryTitle.includes('logo') || rawCategoryTitle.includes('video');

    if (isMediaCategory) {
        return false;
    }

    for (let i = 0; i < NUM_CLUES; i++) {
        const clue = category.clues[i];

        if (!clue) {
            return false;
        }

        const year = parseInt(clue.airdate.slice(0, 4));
        const rawQuestion = formatRaw(clue.question);

        const isValid = rawQuestion.length > 0 && clue.invalid_count === null;
        const isMediaQuestion =
            rawQuestion.includes('seenhere') ||
            rawQuestion.includes('picturedhere') ||
            rawQuestion.includes('heardhere') ||
            rawQuestion.includes('video');
        const isDecade = year >= decade;

        if (!isValid || isMediaQuestion || !isDecade) {
            return false;
        }

        clue.completed = false;
        clue.dailyDouble = false;
    }

    category.year = category.clues[0].airdate.slice(0, 4);
    category.completed = false;
    category.numCluesUsed = 0;

    return true;
};

const approveGame = (categories, doubleJeopartyCategories, finalJeopartyClue) => {
    if (categories.length != NUM_CATEGORIES || doubleJeopartyCategories.length != NUM_CATEGORIES || !_.get(finalJeopartyClue, 'question')) {
        return false;
    }

    for (let i = 0; i < NUM_CLUES; i++) {
        let category = categories[i];
        let doubleJeopartyCategory = doubleJeopartyCategories[i];

        if (!category || category.clues.length != NUM_CLUES || !doubleJeopartyCategory || doubleJeopartyCategory.clues.length != NUM_CLUES) {
            return false;
        }
    }

    return true;
};

exports.getRandomCategories = (decade, cb) => {
    let categories = [];
    let doubleJeopartyCategories = [];
    let finalJeopartyClue = {};
    let usedCategoryIds = [];

    let iterations = 0;

    while (true) {
        iterations++;
        if (iterations > 100000) {
            cb(categories, doubleJeopartyCategories, finalJeopartyClue, true);
            return;
        }

        let category = getRandomCategory(decade);

        if (!category || usedCategoryIds.includes(category.id) || !category.clues || category.clues.length != NUM_CLUES) {
            continue;
        }

        usedCategoryIds.push(category.id);

        if (categories.length < NUM_CATEGORIES) {
            categories.push(category);
            continue;
        } else if (doubleJeopartyCategories.length < NUM_CATEGORIES) {
            doubleJeopartyCategories.push(category);
            continue;
        } else {
            finalJeopartyClue = choice(finalJeopartyClues);
            finalJeopartyClue.categoryName = finalJeopartyClue.category;
        }

        if (approveGame(categories, doubleJeopartyCategories, finalJeopartyClue)) {
            const [categoryIndex, clueIndex, djCategoryIndex1, djClueIndex1, djCategoryIndex2, djClueIndex2] = getDailyDoubleIndices();
            categories[categoryIndex].clues[clueIndex].dailyDouble = true;
            doubleJeopartyCategories[djCategoryIndex1].clues[djClueIndex1].dailyDouble = true;
            doubleJeopartyCategories[djCategoryIndex2].clues[djClueIndex2].dailyDouble = true;

            // console.log("======================== START JEOPARTY CATEGORIES ========================");
            // console.log(categories);
            // console.log("======================== END JEOPARTY CATEGORIES ========================\n");

            // console.log("======================== START DOUBLE JEOPARTY CATEGORIES ========================");
            // console.log(doubleJeopartyCategories);
            // console.log("======================== END DOUBLE JEOPARTY CATEGORIES ========================\n");

            // console.log("======================== START FINAL JEOPARTY CLUE ========================");
            // console.log(finalJeopartyClue);
            // console.log("======================== END FINAL JEOPARTY CLUE ========================\n");

            break;
        }
    }

    cb(categories, doubleJeopartyCategories, finalJeopartyClue, false);
};