import Reverso from 'reverso-api'
import { getLogger} from 'ydb-sdk';

const logger = getLogger();
const reverso = new Reverso()

export async function getTranslation(word: string) {
    let result: string[] = []
    await reverso.getTranslation(
        `${word}`,
        'english',
        'russian',
        (err, response) => {
            if (err) throw new Error(err.message)
            logger.info(response)
            result.push(response.translations[0])
            result.push(`${response.context.examples[0].source} - ${response.context.examples[0].target}`)
            result.push(`${response.context.examples[1].source} - ${response.context.examples[1].target}`)
        }
    )
    return result;
}
