import {getLogger} from 'ydb-sdk';
import {v4} from 'uuid';

const logger = getLogger();

export async function createDictionary(dictionaryName: string, username: string, session) {
    const query = `UPSERT INTO dictionaries (id, name, username) VALUES ('${v4()}', '${dictionaryName}', '${username}');`
    logger.info(`Query constructed ${query}`);
    await session.executeQuery(query);
    logger.info('Dictionary created');
}

export async function getAllDictionaries(username: string, session) {
    const query = `SELECT name FROM dictionaries WHERE username == '${username}';`
    logger.info(`Query constructed ${query}`);
    const result = await session.executeQuery(query);
    logger.info(JSON.stringify(result));
    logger.info(JSON.stringify(result.resultSets[0]));
    return result.resultSets[0];
}

export async function saveCardToDictionary(dictionaryName: string, frontSide: string, backSide: string, username: string, session) {
    const queryDicId = `SELECT id FROM dictionaries WHERE name == '${dictionaryName}' AND username == '${username}' LIMIT 1;`
    const dicIdResult = await session.executeQuery(queryDicId);
    const dicId = dicIdResult.resultSets[0].rows[0].items[0].bytesValue;
    logger.info(`получен id словаря ${dicId}`)

    let escapedBackSide1 = backSide.replace(/\\/g, "\\\\")
    let escapedBackSide2 = escapedBackSide1.replace(/'/g, "\\'");
    const queryAddCard = `UPSERT INTO cards (id, back_side, dictionary_id, front_side, repeat_count) VALUES ('${v4()}', '${escapedBackSide2}', '${dicId}', '${frontSide}', 0);`
    logger.info(escapedBackSide2)
    logger.info(`queryAddCard ${queryAddCard}`)
    await session.executeQuery(queryAddCard);
    logger.info('Card created');
    return true;
}

export async function getCardsFromDictionary(dictionaryName: string, username: string, session) {
    const queryDicId = `SELECT id FROM dictionaries WHERE name == '${dictionaryName}' AND username == '${username}' LIMIT 1;`
    const dicIdResult = await session.executeQuery(queryDicId);
    const dicId = dicIdResult.resultSets[0].rows[0].items[0].bytesValue;
    logger.info(`получен id словаря ${dicId}`)

    const querySelectCards = `SELECT * FROM cards WHERE dictionary_id == '${dicId}' ORDER BY repeat_count;`
    const result = await session.executeQuery(querySelectCards);
    logger.info('Cards selected');
    logger.info(JSON.stringify(result));
    logger.info(JSON.stringify(result.resultSets[0]));
    return result.resultSets[0];
}

export async function addCardRepeat(cardId: string, session) {
    const query = `UPDATE cards SET repeat_count = repeat_count + 1 WHERE id == '${cardId}';`
    await session.executeQuery(query);
    logger.info('Repeat time increased');
}

export async function minusCardRepeat(cardId: string, session) {
    const query = `UPDATE cards SET repeat_count = repeat_count - 1 WHERE id == '${cardId}';`
    await session.executeQuery(query);
    logger.info('Repeat time increased');
}