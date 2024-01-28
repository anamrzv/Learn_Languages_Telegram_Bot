import {Bot, Context, InlineKeyboard, session, SessionFlavor} from 'grammy'
import {Menu} from '@grammyjs/menu'
import {type Conversation, type ConversationFlavor, conversations, createConversation,} from "@grammyjs/conversations";
import {Driver, getLogger, MetadataAuthService} from 'ydb-sdk';
import {getTranslation} from './translator'
import {
    addCardRepeat,
    createDictionary,
    getAllDictionaries,
    getCardsFromDictionary,
    minusCardRepeat,
    saveCardToDictionary
} from './database'

const logger = getLogger();

const authService = new MetadataAuthService()
const endpoint = process.env.ENDPOINT;
const database = process.env.DATABASE;

const driver = new Driver({endpoint, database, authService});

interface SessionData {
    chosenDicName: string,
    currentRow: number,
    cards: any,
    dictionaries: any
}

type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor
type MyConversation = Conversation<MyContext>;

const bot = new Bot<MyContext>(process.env.BOT_TOKEN)

bot.use(
    session({
        initial(): SessionData {
            return {
                chosenDicName: "",
                currentRow: 0,
                cards: [],
                dictionaries: undefined
            }
        },
    })
)


bot.use(conversations());

async function askDictionaryName(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply("Введите название нового словаря, в котором будут храниться ваши слова:");
    //const {message} = await conversation.wait();
    const dictionaryName: string = await conversation.form.text();

    await driver.tableClient.withSession(async (session) => await createDictionary(dictionaryName, ctx.from.username, session))
    await ctx.reply(`Словарь ${dictionaryName} создан`)
    return
}

async function createNewCard(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply("Введите новое слово на английском языке.\nБот автоматически переведет его на русский язык и найдет примеры употребления");
    const {message} = await conversation.wait();
    const frontSide: string | undefined = message.text;

    const translateResult = await getTranslation(frontSide);
    const backSide = `Перевод:\n${translateResult[0]}\nПримеры употребления:\n1. ${translateResult[1]}\n2. ${translateResult[2]}`
    logger.info(`user ${ctx.from.username}`)

    await driver.tableClient.withSession(async (session) => await saveCardToDictionary(ctx.session.chosenDicName, frontSide, backSide, ctx.from.username, session))
    await ctx.reply(`Карточка "${frontSide}" добавлена в словарь "${ctx.session.chosenDicName}":`)
    await ctx.reply(`${backSide}`)
    return
}

bot.use(createConversation(askDictionaryName));
bot.use(createConversation(createNewCard));

const mainText = 'Добро пожаловать в бот по изучению английских слов! Что вы хотите сделать?'
const mainMenu = new Menu<MyContext>('mainMenu')
mainMenu
    .text("📖 Создать словарь", async (ctx, conversation) => {
        await ctx.conversation.enter("askDictionaryName");
    }).row()
    .submenu("🔍 Выбрать словарь", "dictionaryMenu");

const dictionaryMenu = new Menu<MyContext>('dictionaryMenu')
dictionaryMenu
    .dynamic(async (ctx, range) => {
        if (ctx.session.dictionaries == undefined) {
            let answer: { rows: any; };
            await driver.tableClient.withSession(async (session) => answer = await getAllDictionaries(ctx.from.username, session))
            ctx.session.dictionaries = answer.rows
        }

        for (const row of ctx.session.dictionaries) {
            range
                .text(`${row.items[0].bytesValue}`, async (ctx) => {
                    const inlineKeyboard = new InlineKeyboard()
                        .text(`⭐️ Добавить слово`, `add ${row.items[0].bytesValue}`)
                        .text(`💬 Повторять слова`, `repeat ${row.items[0].bytesValue}`)
                    ctx.session.chosenDicName = `${row.items[0].bytesValue}`
                    await ctx.reply(`Вы выбрали словарь "${row.items[0].bytesValue}"`, {
                        reply_markup: inlineKeyboard,
                    })
                })
                .row();
        }
    })
    .back("Назад");

bot.callbackQuery(/add (.+)/, async (ctx) => {
    ctx.session.chosenDicName = ctx.match[1]
    await ctx.conversation.enter("createNewCard");
})

bot.callbackQuery(/repeat (.+)/, async (ctx) => {
    ctx.session.chosenDicName = ctx.match[1]
    let answer;
    await driver.tableClient.withSession(async (session) => answer = await getCardsFromDictionary(ctx.session.chosenDicName, ctx.from.username, session))
    ctx.session.cards = answer.rows
    if (ctx.session.cards.length > 0) {
        ctx.session.currentRow = 0;

        const firstCardFrontSide = `${ctx.session.cards[0].items[2].bytesValue}`;
        const inlineKeyboard = new InlineKeyboard()
            .text("✅ Помню", `remember ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("❌ Не помню", `forget ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("◀️ Отмена", `stop`)
        await ctx.reply(firstCardFrontSide, {
            reply_markup: inlineKeyboard,
        })
    } else {
        await ctx.reply("Словарь пуст. Добавьте слова,чтобы начать повторять слова!")
    }
})

mainMenu.register(dictionaryMenu)

bot.use(mainMenu)

bot.callbackQuery(/remember (.+) (.+)/, async (ctx) => {
    ctx.session.chosenDicName = ctx.match[1]
    ctx.session.currentRow = parseInt(ctx.match[2], 10)
    let answer;
    await driver.tableClient.withSession(async (session) => answer = await getCardsFromDictionary(ctx.session.chosenDicName, ctx.from.username, session))
    ctx.session.cards = answer.rows

    let rowNum: number = ctx.session.currentRow
    await driver.tableClient.withSession(async (session) => await addCardRepeat(ctx.session.cards[rowNum].items[3].bytesValue, session))
    const currentCardFrontSide = `${ctx.session.cards[rowNum].items[0].bytesValue}`;
    await ctx.reply(`Ответ:\n${currentCardFrontSide}`)

    ctx.session.currentRow++;
    rowNum++
    if (ctx.session.cards.length !== rowNum) {
        const nextCardFrontSide = `${ctx.session.cards[rowNum].items[2].bytesValue}`;
        const inlineKeyboard = new InlineKeyboard()
            .text("✅ Помню", `remember ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("❌ Не помню", `forget ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("◀️ Отмена", `stop`)
        await ctx.reply(nextCardFrontSide, {
            reply_markup: inlineKeyboard,
        })
    } else {
        ctx.session.currentRow = 0
        ctx.session.cards = []
        ctx.session.chosenDicName = ""
        await ctx.reply('Вы повторили все слова!', {reply_markup: mainMenu})
    }
});

bot.callbackQuery(/forget (.+) (.+)/, async (ctx) => {
    ctx.session.chosenDicName = ctx.match[1]
    ctx.session.currentRow = parseInt(ctx.match[2], 10)
    let answer;
    await driver.tableClient.withSession(async (session) => answer = await getCardsFromDictionary(ctx.session.chosenDicName, ctx.from.username, session))
    ctx.session.cards = answer.rows

    let rowNum: number = ctx.session.currentRow
    await driver.tableClient.withSession(async (session) => await minusCardRepeat(ctx.session.cards[rowNum].items[3].bytesValue, session))
    const currentCardFrontSide = `${ctx.session.cards[rowNum].items[0].bytesValue}`;
    await ctx.reply(`Ответ:\n${currentCardFrontSide}`)

    ctx.session.currentRow++;
    rowNum++
    if (ctx.session.cards.length !== rowNum) {
        const nextCardFrontSide = `${ctx.session.cards[rowNum].items[2].bytesValue}`;
        const inlineKeyboard = new InlineKeyboard()
            .text("✅ Помню", `remember ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("❌ Не помню", `forget ${ctx.session.chosenDicName} ${ctx.session.currentRow}`)
            .text("◀️ Отмена", `stop`)
        await ctx.reply(nextCardFrontSide, {
            reply_markup: inlineKeyboard,
        })
    } else {
        ctx.session.currentRow = 0
        ctx.session.cards = []
        ctx.session.chosenDicName = ""
        await ctx.reply('Вы повторили все слова!', {reply_markup: mainMenu})
    }
});

bot.callbackQuery("stop", async (ctx) => {
    ctx.session.currentRow = 0
    ctx.session.cards = []
    ctx.session.chosenDicName = ""
    await ctx.reply("Вы покинули режим повторения", {reply_markup: mainMenu})
});

bot.command('start', ctx => ctx.reply(mainText, {reply_markup: mainMenu}))

bot.command('help', async ctx => {
    const text =
        'Используйте команду /start для начала работы'
    await ctx.reply(text)
})


bot.catch(console.error.bind(console))

module.exports.handler = async function (event, context) {
    try {
        logger.info(`АААА ${JSON.stringify(event)}`)
        const message = JSON.parse(event['messages'][0]['details']['message']['body']);
        await bot.init()
        await bot.handleUpdate(message);
        return {
            statusCode: 200,
            body: '',
        };
    } catch (e) {
        console.error(`Error occured: ${e}`);
    } finally {
        await driver.destroy();
    }
};