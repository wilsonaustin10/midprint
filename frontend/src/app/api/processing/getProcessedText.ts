import { JSDOM } from 'jsdom';

/**
 * Extracts interactive elements from HTML for LLM processing.
 * This is a server-side function because JSDOM doesn't work client-side.
 * @param {string} pageSource - HTML source text
 * @param {string} baseUrl - URL of the HTML source
 * @returns {Promise<{clickableElements: any[], formElements: any[], visibleText: string}>}
 */
export async function extractInteractiveElements(pageSource: string) {
    try {
        // Before creating JSDOM instance
        const strippedHTML = pageSource
            .replace(/<link[^>]*rel=['"]stylesheet['"][^>]*>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        const { window } = new JSDOM(strippedHTML, {
            runScripts: "outside-only",
            resources: "usable",
            pretendToBeVisual: true,
            includeNodeLocations: true,
            storageQuota: 10000000,
            features: {
                FetchExternalResources: ['script'],
                ProcessExternalResources: ['script'],
                SkipExternalResources: /(css)/
            }
        });
        const { document } = window;

        // Extract clickable elements (links, buttons, etc.)
        const clickableElements = Array.from(
            document.querySelectorAll('a, button, [role="button"], [onclick], [class*="btn"], [type="submit"], input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]')
        ).map(element => {
            const rect = element.getBoundingClientRect();
            const isVisible = !!(
                rect.width && 
                rect.height && 
                window.getComputedStyle(element).display !== 'none' && 
                window.getComputedStyle(element).visibility !== 'hidden'
            );
            
            // Generate a useful selector for this element
            const id = element.id ? `#${element.id}` : '';
            const classes = Array.from(element.classList).map(c => `.${c}`).join('');
            const tagName = element.tagName.toLowerCase();
            const selectorParts = [];
            
            if (id) selectorParts.push(id);
            if (classes) selectorParts.push(classes);
            if (!id && !classes) selectorParts.push(tagName);
            
            const selector = selectorParts.join('') || tagName;
            
            // Create a comprehensive object with element details
            return {
                type: 'clickable',
                tagName: element.tagName.toLowerCase(),
                text: element.textContent?.trim() || '',
                selector,
                id: element.id || null,
                classes: Array.from(element.classList) || [],
                href: element.getAttribute('href') || null,
                role: element.getAttribute('role') || null,
                ariaLabel: element.getAttribute('aria-label') || null,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                // isVisible: true, // TODO: Check if this is even needed
                isVisible, // TODO: Check if this is even needed
            };
        }).filter(el => el.isVisible); // Only include visible elements
        
        // Extract form elements (inputs, textareas, selects, etc.)
        const formElements = Array.from(
            document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="button"], [role="link"]')
        ).map(element => {
            const rect = element.getBoundingClientRect();
            const isVisible = !!(
                rect.width && 
                rect.height && 
                window.getComputedStyle(element).display !== 'none' && 
                window.getComputedStyle(element).visibility !== 'hidden'
            );
            
            // Generate a useful selector for this element
            const id = element.id ? `#${element.id}` : '';
            const name = element.getAttribute('name') ? `[name="${element.getAttribute('name')}"]` : '';
            const classes = Array.from(element.classList).map(c => `.${c}`).join('');
            const tagName = element.tagName.toLowerCase();
            const selectorParts = [];
            
            if (id) selectorParts.push(id);
            if (name) selectorParts.push(name);
            if (classes) selectorParts.push(classes);
            if (!id && !name && !classes) selectorParts.push(tagName);
            
            const selector = selectorParts.join('') || tagName;
            
            // Get element type
            const type = element.getAttribute('type') || 
                         (element.tagName.toLowerCase() === 'textarea' ? 'textarea' : 
                         (element.tagName.toLowerCase() === 'select' ? 'select' : 'text'));
            
            // Create a comprehensive object with element details
            return {
                type: 'form',
                inputType: type,
                tagName: element.tagName.toLowerCase(),
                selector,
                id: element.id || null,
                name: element.getAttribute('name') || null,
                placeholder: element.getAttribute('placeholder') || null,
                value: element.getAttribute('value') || null,
                isRequired: element.hasAttribute('required'),
                isDisabled: element.hasAttribute('disabled'),
                isReadOnly: element.hasAttribute('readonly'),
                isChecked: element.hasAttribute('checked'),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                // isVisible: true, // TODO: Check if this is even needed
                isVisible, // TODO: Check if this is even needed
                ariaLabel: element.getAttribute('aria-label') || null,
                ariaDescription: element.getAttribute('aria-description') || null
            };
        }).filter(el => el.isVisible); // Only include visible elements
        
        // Also extract a concise representation of the page's main content
        const mainContent = document.querySelector('main') || document.querySelector('body');
        const visibleTextNodes = [];
        
        if (mainContent) {
            // Recursively extract text from visible elements
            const extractTextFromNode = (node) => {
                if (node.nodeType === 3) { // Text node
                    const text = node.textContent?.trim();
                    if (text) visibleTextNodes.push(text);
                } else if (node.nodeType === 1) { // Element node
                    const isVisible = !(
                        node.hasAttribute('hidden') || 
                        node.style.display === 'none' || 
                        node.style.visibility === 'hidden'
                    );
                    
                    if (isVisible) {
                        if (node.tagName.toLowerCase() === 'img' && node.alt) {
                            visibleTextNodes.push(`[Image: ${node.alt}]`);
                        } else {
                            Array.from(node.childNodes).forEach(extractTextFromNode);
                        }
                    }
                }
            };
            
            extractTextFromNode(mainContent);
        }
        
        const visibleText = visibleTextNodes.join(' ').replace(/\s+/g, ' ').trim();
        
        return {
            clickableElements,
            formElements,
            visibleText
        };
    } catch (e) {
        console.error('Error while extracting interactive elements:', e);
        return {
            clickableElements: [],
            formElements: [],
            visibleText: ''
        };
    }
}

// Keep the original function for backward compatibility
export async function getProcessedText(pageSource: string, baseUrl: string, options: {
    keepImages?: boolean;
    removeSvgImage?: boolean;
    removeGifImage?: boolean;
    removeImageTypes?: string[];
    keepWebpageLinks?: boolean;
    removeScriptTag?: boolean;
    removeStyleTag?: boolean;
    removeTags?: string[];
} = {}) {
    // Default options
    const {
        keepImages = true,
        removeSvgImage = true,
        removeGifImage = true,
        removeImageTypes = [],
        keepWebpageLinks = true,
        removeScriptTag = true,
        removeStyleTag = true,
        removeTags = []
    } = options;

    try {
        // Before creating JSDOM instance
        const strippedHTML = pageSource
            .replace(/<link[^>]*rel=['"]stylesheet['"][^>]*>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        // Use JSDOM instead of BeautifulSoup
        const { window } = new JSDOM(strippedHTML, {
            runScripts: "outside-only",
            resources: "usable",
            pretendToBeVisual: true,
            includeNodeLocations: true,
            storageQuota: 10000000,
            features: {
                FetchExternalResources: ['script'],
                ProcessExternalResources: ['script'],
                SkipExternalResources: /(css)/
            }
        });
        const { document } = window;

        // Remove tags
        const tagsToRemove = [...removeTags];
        if (removeScriptTag) tagsToRemove.push('script');
        if (removeStyleTag) tagsToRemove.push('style');

        // Remove duplicate tags
        const uniqueTagsToRemove = [...new Set(tagsToRemove)];

        uniqueTagsToRemove.forEach(tagName => {
            const elements = document.querySelectorAll(tagName);
            elements.forEach(element => {
                try {
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                } catch (e) {
                    console.error('Error while removing tag:', e);
                }
            });
        });

        // Process image links
        const removeImageType = [];
        if (removeSvgImage) removeImageType.push('.svg');
        if (removeGifImage) removeImageType.push('.gif');
        removeImageType.push(...removeImageTypes);

        // Remove duplicate image types
        const uniqueRemoveImageType = [...new Set(removeImageType)];

        const images = document.querySelectorAll('img');
        images.forEach(image => {
            try {
                if (!keepImages && image.parentNode) {
                    image.parentNode.replaceChild(document.createTextNode(''), image);
                } else if (image.parentNode) {
                    const imageLink = image.getAttribute('src');
                    let typeReplaced = false;

                    if (imageLink && uniqueRemoveImageType.length > 0) {
                        for (const imageType of uniqueRemoveImageType) {
                            if (!typeReplaced && imageLink.includes(imageType) && image.parentNode) {
                                image.parentNode.replaceChild(document.createTextNode(''), image);
                                typeReplaced = true;
                            }
                        }
                    }

                    if (!typeReplaced && imageLink && image.parentNode) {
                        const fullUrl = new URL(imageLink, baseUrl).href;
                        image.parentNode.replaceChild(
                            document.createTextNode('\n' + fullUrl + ' '),
                            image
                        );
                    }
                }
            } catch (e) {
                console.error('Error while processing image link:', e);
            }
        });

        // Process website links
        const links = document.querySelectorAll('a[href]');
        links.forEach(link => {
            try {
                if (!keepWebpageLinks && link.parentNode) {
                    link.parentNode.replaceChild(document.createTextNode(''), link);
                } else if (link.parentNode) {
                    const href = link.getAttribute('href');
                    if (href) {
                        const fullUrl = new URL(href, baseUrl).href;
                        link.parentNode.replaceChild(
                            document.createTextNode((link.textContent || '') + ': ' + fullUrl + ' '),
                            link
                        );
                    }
                }
            } catch (e) {
                console.error('Error while processing webpage link:', e);
            }
        });

        // Extract text
        let text = '';
        const body = document.querySelector('body');

        if (body) {
            // We don't have direct equivalents for minify and inscriptis in JS
            // So we'll use a simple text extraction approach
            text = body.textContent || '';

            // Clean up whitespace
            text = text.replace(/\s+/g, ' ').trim();

            // Add line breaks for better readability
            const headings = body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div');
            headings.forEach(heading => {
                const content = heading.textContent?.trim() || '';
                if (content) {
                    text = text.replace(content, '\n' + content + '\n');
                }
            });
        } else {
            text = document.documentElement.textContent || '';
        }

        return text;
    } catch (e) {
        console.error('Error while getting processed text:', e);
        return '';
    }
}
