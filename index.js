const readline = require('node:readline')
const puppeteer = require("puppeteer")
const fs = require("node:fs")
const { stdin: input, stdout: output } = require('node:process')
const rl = readline.createInterface({ input, output })

const { createClient } = require("oicq")
const config = JSON.parse(fs.readFileSync("config.json"))
const QQ = createClient(config.QQ)

QQ.config.platform = 5
QQ.config.log_level = "warn"

QQ.on("system.login.qrcode", function (e) {
    //扫码后按回车登录
    process.stdin.once("data", () => {
        this.login()
    })
}).login()

QQ.on("system.online", () => console.log("qq已登陆"))

//问题处理列队
let questionQueue = []
let loopEnable = false
//风控大礼包？
let gift = 0

const command = {
    list: {
        introduction: "列出所有命令",
        func: async () => {
            for (const key in command) {
                console.log(`${key} : ${command[key].introduction}`)
            }
        }
    },
    login: {
        introduction: "跳转到登陆页",
        func: async (get) => {
            await get.page.goto("https://chat.openai.com/auth/login")
            console.log("ok")
        }
    },
    start: {
        introduction: "开启对话",
        func: async (get) => {
            //是否有cookie
            if (fs.existsSync("cookie.json")) {
                const cookiesString = fs.readFileSync("cookie.json")
                const cookies = JSON.parse(cookiesString)
                await get.page.setCookie(...cookies)
                await get.page.goto("https://chat.openai.com/chat")
                //添加css干掉对话框
                await get.page.addStyleTag({
                    content: `
                .fixed.inset-0.z-60.overflow-y-auto{display:none}
                .fixed.inset-0.transition-opacity{display:none}
                ` })
                console.log("ok")
                loopEnable = true //on
                QQ.on("message", async (e) => {
                    let message = e.raw_message
                    if (message.charAt(0) == '%') {
                        //这是个问题
                        message = message.substring(1)
                        questionQueue.push({ message, e, page: get.page })
                        e.reply(`你的问题已在列队，排在${questionQueue.length}`, true)
                        console.log(`${e.sender.nicknam}:${e.sender.user_id} 说 ${e.raw_message}`)
                    }
                })
                console.log("QQ complete")

            } else {
                console.log("请先登陆")
                return
            }
        }
    },
    save: {
        introduction: "保存cookie",
        func: async (get) => {
            const cookies = await get.page.cookies()
            fs.writeFileSync("cookie.json", JSON.stringify(cookies))
            console.log(cookies)
        }
    },
    testChat: {
        introduction: "测试对话",
        func: async (get) => {
            while (true) {
                const answerNumber = await get.page.evaluate(() => { return document.querySelectorAll(".flex.w-full>.gap-4>.break-words").length })
                //现在的答案数量
                console.log("现在答案数量：" + answerNumber)
                const question = await cmdGet("请输入问题:")
                await get.page.type("textarea", question)
                await get.page.keyboard.press("Enter")

                await get.page.waitForFunction((number) => {
                    const answerNumber = document.querySelectorAll(".flex.w-full>.gap-4>.break-words").length
                    return document.querySelector("button>.text-2xl") == null && answerNumber > number
                }, {}, answerNumber)
                //等待答案出现
                console.log("answer ok")
                const answer = await get.page.evaluate(() => {
                    const answer = document.querySelectorAll(".flex.w-full>.gap-4>.break-words")
                    console.log("nums:" + answer.length, answer)
                    return answer[answer.length - 1].innerText
                }, answerNumber)
                console.log("answer:" + answer)
            }
        }
    }
}
function askGPT(page, question) {
    return new Promise(async resolve => {
        try {
            //在页面准备好的时候询问GPT
            const answerNumber = await page.evaluate(() => { return document.querySelectorAll(".flex.w-full>.gap-4>.break-words").length })
            //现在的答案数量
            await page.type("textarea", question)
            await page.keyboard.press("Enter")

            await page.waitForFunction((number) => {
                const answerNumber = document.querySelectorAll(".flex.w-full>.gap-4>.break-words").length
                return document.querySelector("button>.text-2xl") == null && answerNumber > number
            }, { timeout: 80 * 1000, polling: 1000 }, answerNumber)
            //等待答案出现
            console.log("askGPT:answer ok")
            const answer = await page.evaluate(() => {
                const answer = document.querySelectorAll(".flex.w-full>.gap-4>.break-words")
                return answer[answer.length - 1].innerText
            }, answerNumber)
            resolve({ status: true, answer: answer })
        } catch (err) {
            resolve({ status: false })
        }
    })
}

(async () => {

    const browser = await puppeteer.launch({
        headless: config.browser_headless, //隐藏浏览器？
    })
    console.log("浏览器启动")
    const page = await browser.newPage()

    command.list.func()
    while (true) {
        const cmd = await cmdGet("请输入命令:")
        if (command[cmd]) {
            await command[cmd].func({ page: page })
        } else {
            console.log("命令不存在")
        }
    }

})()


function cmdGet(question) {
    return new Promise(resolve => {
        rl.question(question, answer => {
            console.log("pass")
            resolve(answer)
        })
    })
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

(async ()=>{
    while (true) {
        if (loopEnable && questionQueue.length > 0) {
            const question = questionQueue.shift()
            const answer = await askGPT(question.page, question.message)
            if (answer.status) {
                question.e.reply(`${answer.answer} \nby chatGPT`, true)
            } else {
                question.e.reply(`
                好像有点问题，我认为可能是如下几个原因 
                1.你的问题过于逆天
                2.你的问题过于简单，无法理解
                3.提问速度过快被风控辣
                `, true)
                gift = 240000
                await question.page.reload()
                await question.page.addStyleTag({
                    content: `
                .fixed.inset-0.z-60.overflow-y-auto{display:none}
                .fixed.inset-0.transition-opacity{display:none}
                ` })
            }
        }
        let time = 20000 + gift + Math.random() * 10000
        gift = 0 
        await sleep(time)
    }
})()

//怪东西，你不应该用这个的