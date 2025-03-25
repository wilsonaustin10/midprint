import { getBrowserPool } from "@/lib/browser-pool";
import OpenAI from "openai"
import { extractInteractiveElements, getProcessedText } from "../processing/getProcessedText";
import { computerUseSystemPrompt, computerUseUserPrompt } from "@/lib/prompt-templates";
import { computerUseFunctions } from "@/lib/agent-functions";
import { Message } from "@/types/messages";
import { navigateTo, performAction } from "@/app/actions/browser";
import { BrowserActions } from "./actions";


/**
 * 
 * @param sessionId 
 * @param getAllData- - An optional param that forces the function to refetch ALL data, including the expensive operations
 * @returns 
 */
export async function getPageInfo(sessionId: string, getAllData?: boolean) {
    const browserPool = await getBrowserPool();
    const { page } = await browserPool.getBrowser(sessionId);

    // Basic page data
    const content = await page.content();
    const currentUrl = await page.url();

    console.log(`[getPageInfo] Current URL for session ${sessionId}: ${currentUrl}`);

    const screenshot = await page.screenshot({
        fullPage: false,
        quality: 80,
        type: "jpeg"
    });

    const screenshotBase64 = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
    const title = await page.title();

    // Extract interactive elements from the page
    const shortenedHtml = await getProcessedText(content, currentUrl)
    const { clickableElements, formElements, visibleText } = await extractInteractiveElements(content);

    // Create page info object
    const pageInfo = {
        url: currentUrl,
        title,
        screenshot: screenshotBase64,
        clickableElements, // TODO: Revert back once token limit it resolved
        formElements,
        content: shortenedHtml
    }
    return pageInfo;
}

/**
 * Main computer-use task logic
 */
export async function executeTaskLoop(model: string, userMessage: string, sessionId: string) {
    const allResponses: Message[] = []
    try {
        const openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        })
        let done = false;
        const maxIterations = 5;
        let currentIteration = 0

        // Used to store all responses for the UI to display
        const messageHistory: Message[] = [
            {
                "role": "system",
                "content": computerUseSystemPrompt
            },
            {
                "role": "user",
                "content": `User message: ${userMessage}`
            },
        ]
        while (!done && currentIteration < maxIterations) {

            currentIteration++;
            const { screenshot, ...pageInfo } = await getPageInfo(sessionId)

            const response = await openaiClient.chat.completions.create({
                model: model,
                messages: [
                    ...messageHistory,
                    {
                        "role": "user",
                        "content": [
                            {
                                type: "text",
                                text: computerUseUserPrompt(pageInfo)
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: screenshot
                                }
                            }
                        ]
                    }
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
                functions: computerUseFunctions,
                function_call: "auto"
            })

            const responseMessage = response.choices[0].message;

            messageHistory.push({
                role: "assistant",
                content: responseMessage.content ?? "",
            })

            if (responseMessage.function_call) {
                const result = await executeFunction(responseMessage.function_call, sessionId);
                console.debug(`Function ${responseMessage.function_call.name} success: ${result ? result.success : 'Result is null'}`);

            } else {
                try {
                    if (responseMessage.content) {
                        const content = JSON.parse(responseMessage.content);
                        if (content.status === "done" || content.status === "error" || content.status === "awaiting_user_input") {
                            done = true;
                            console.info(`Task completed with status: ${content.status}`);
                        }
                    }
                } catch (error) {
                    console.warn("Could not parse response content as JSON:", error);
                }
            }

            messageHistory.push(responseMessage);
            allResponses.push(responseMessage);
            // Add a short delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 1000));

        }

        return {
            messages: allResponses,
            iterations: currentIteration,
            completed: done,
        }
    } catch (error) {
        console.error("Error executing task loop:", error);
        return {
            messages: allResponses,
            iterations: -1,
            completed: false,
        }
    }
}

async function executeFunction(functionCall: any, sessionId: string) {
    if (!functionCall) return null;

    const { name, arguments: argsString } = functionCall;
    const args = JSON.parse(argsString);

    console.info(`Executing function: ${name} with args: ${JSON.stringify(args)}`);

    try {

        switch (name) {
            case BrowserActions.NAVIGATE_TO:
                return await navigateTo(args.url, sessionId);
            case BrowserActions.CLICK_ELEMENT:
                return await performAction('click', args.selector, undefined, sessionId)
            case BrowserActions.FILL_INPUT:
                return await performAction('fill', args.selector, args.value, sessionId)
            case BrowserActions.PRESS:
                return await performAction('press', args.selector, args.key, sessionId)
            case BrowserActions.EXTRACT:
                return await performAction('extract', args.selector, undefined, sessionId)
            default:
                console.warn(`Unhandled function: ${name}`);
                return null;

        }
    } catch (error) {
        console.error(`Error executing function: ${name}`, error);
        return { error: error.message }
    }

}