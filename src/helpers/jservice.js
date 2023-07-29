const request = require('request');
const qs = require('query-string');
const fs = require('fs');
const _ = require('lodash');

const formatRaw = require('./format').formatRaw;
const formatCategory = require('./format').formatCategory;

const MAX_CATEGORY_ID = 18418;
const NUM_CLUES = 5;

class jServiceApi{
	constructor() {
		this._url = 'http://jservice.io/api/'
	}

	_makeRequest(url, callback) {
		url = this._url + url;
		request(url, function(err, response, json) {
            if (response) {
                const parsedJson = response.statusCode == 200 ? JSON.parse(json) : undefined;
                callback(err, response, parsedJson);
            } else {
                callback(false, { 'statusCode': 400 }, {});
            }
		});
	}

    category(id, callback) {
		const url = 'category?' + qs.stringify({'id' : id});
		this._makeRequest(url, callback);
	}
}

const js = new jServiceApi();

const getRandomCategory = (decade, categoryId, cb) => {
    js.category(categoryId, (error, response, category) => {
        if (!error && response.statusCode === 200) {
            if (approveCategory(category, decade)) {
                cb(false, formatCategory(category));
            } else {
                cb(false, { categoryId: categoryId });
            }
        } else {
            console.log(`Error: ${response.statusCode}`);
            cb(true, { categoryId: categoryId, statusCode: response.statusCode });
        }
    });
};

const approveCategory = (category, decade) => {
    const rawCategoryTitle = formatRaw(category.title);
    const isMediaCategory = rawCategoryTitle.includes('logo') || rawCategoryTitle.includes('video');

    let minClueIndex = 0;
    let failures = 0;

    for (let i = 0; i < category.clues_count; i++) {
        if (i < minClueIndex) {
            continue;
        }

        const clue = category.clues[i];

        if (!clue) {
            minClueIndex += NUM_CLUES;
            failures += 1;
            continue;
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
            minClueIndex += NUM_CLUES;
            failures += 1;
            continue;
        }

        clue.completed = false;
        clue.dailyDouble = false;
    }

    if (failures >= Math.floor(category.clues_count / NUM_CLUES)) {
        return false;
    }

    category.completed = false;
    category.numCluesUsed = 0;

    return !isMediaCategory;
};

exports.writeCategories = (decade, cb) => {
    let i = 14590;

    const writeCategoriesDB = (category) => {
        const JSON_FILE = './categoriesDB.json';

        try {
            const jsonData = fs.readFileSync(JSON_FILE);
            let categoriesDB = JSON.parse(jsonData);

            categoriesDB[category.id] = category;
            fs.writeFileSync(JSON_FILE, JSON.stringify(categoriesDB));
          } catch (error) {
            console.error(error);
            throw error;
          }
    }

    const recursiveGetCategory = () => {
        getRandomCategory(decade, i, (error, category) => {
            if (error && category.statusCode != 404) {
                console.log(error);
                console.log(error.code);
                // console.log(`Stopping recursion. Error: ${error}`);
                return;
            } else if (i > MAX_CATEGORY_ID) {
                // console.log(`Mission complete!`);
                return;
            } else if (!category || !category.clues || category.clues_count == 0) {
                // console.log(`Skipping category id: ${category.categoryId}`);
            } else {
                console.log(`===================== WRITING CATEGORY ID: ${category.id} =====================`);
                writeCategoriesDB(category);
            }

            let pauseTime = (i % 9 == 0) ? 20 * 1000 : 1 * 1000;
            // console.log(`!!!!!!!!!!! PAUSING for ${pauseTime / 1000} second(s) !!!!!!!!!`);
            setTimeout(() => {
                // console.log("~~~~~~~~~~~ RESUMING ~~~~~~~~~~\n");
                i++;
                recursiveGetCategory();
            }, pauseTime);
        });
    };

    recursiveGetCategory();
};
