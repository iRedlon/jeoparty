const _ = require('lodash');
const removeAccents = require('remove-accents');

exports.formatRaw = (original) => {
    let rawOriginal = original.toLowerCase();

    // Remove accents
    rawOriginal = removeAccents(rawOriginal);

    // HTML tags
    rawOriginal = rawOriginal.replace(/<i>/g, "");
    rawOriginal = rawOriginal.replace("</i>", "");
 
    // Red words
    rawOriginal = rawOriginal.replace(/and /g, "");
    rawOriginal = rawOriginal.replace(/the /g, "");

    // Punctuation
    rawOriginal = rawOriginal.replace(/[^a-zA-Z0-9]/g, "");
    rawOriginal = rawOriginal.replace(/\s{2,}/g, "");
    rawOriginal = rawOriginal.replace(String.fromCharCode(92), "");

    // Spacing
    // rawOriginal = rawOriginal.replace(/ /g, "");

    // Edge cases
    rawOriginal = rawOriginal.replace(/v /g, "");
    rawOriginal = rawOriginal.replace(/v. /g, "");
    rawOriginal = rawOriginal.replace(/vs /g, "");
    rawOriginal = rawOriginal.replace(/vs. /g, "");

    return rawOriginal;
};

exports.formatUtterance = (original) => {
    /*
    Replace parts of the string that are difficult for speech synthesis to pronounce with easier ones
     */

    let rawOriginal = original.toLowerCase();

    // Remove accents
    rawOriginal = removeAccents(rawOriginal);

    // HTML tags
    rawOriginal = rawOriginal.replace(/<i>/g, "");
    rawOriginal = rawOriginal.replace("</i>", "");

    // Replace '______' with 'blank'
    rawOriginal = rawOriginal.replace(/_+/g, 'blank');

    // Replace '...' with ','
    rawOriginal = rawOriginal.replace(/\.+/g, ',');

    return rawOriginal;
};

exports.formatDisplay = (original) => {
    let displayOriginal = original.toLowerCase();

    // Remove accents
    displayOriginal = removeAccents(displayOriginal);

    // Backslashes
    displayOriginal = displayOriginal.replace(String.fromCharCode(92), "");

    // HTML tags
    displayOriginal = displayOriginal.replace(/<i>/g, "");
    displayOriginal = displayOriginal.replace("</i>", "");

    return displayOriginal;
};

exports.formatCategory = (category) => {
    for (let i = 0; i < category.clues.length; i++) {
        let question = category.clues[i].question;

        // Backslashes
        question = question.replace(String.fromCharCode(92), "");

        // HTML tags
        question = question.replace(/<I>/g, "");
        question = question.replace("</I>", "");

        // Parentheses and the text inside of them
        question = question.replace(/ *\([^)]*\) */g, "");

        category.clues[i].question = question;
    }

    return category;
};

exports.formatWager = (rawWager, min, max) => {
    let wager = parseInt(rawWager);

    if (_.isNaN(wager)) {
        return min;
    } else {
        if (wager < min) {
            return min;
        } else if (wager > max) {
            return max;
        } else {
            return wager;
        }
    }
};
