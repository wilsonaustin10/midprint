'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { navigateTo, performAction, ActionResult } from '@/app/actions/browser'
import { BrowserActions } from '@/app/api/browser-service/actions'
import Image from 'next/image'
import { useDebounce } from 'use-debounce'
import LoginCredentialsDialog from './LoginCredentialsDialog'
import { FormElement } from '@/types/common'

export type P = {
    sessionId: string;
    url: string;
    screenshot: string;
    pageTitle: string;
    formElements: FormElement[];
    historyState: {
        canGoBack?: boolean;
        canGoForward?: boolean;
    }
    setUrl: (url: string) => void;
    updateBrowserState: (result: ActionResult) => void
}

export default function InteractiveBrowser({ sessionId, url, screenshot, formElements, historyState, setUrl, updateBrowserState }: P) {
    
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [logs, setLogs] = useState<string[]>([])
    const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false)
    const [loginFields, setLoginFields] = useState<{
        username: { id: string; name: string; testId: string; },
        password: { id: string; name: string; testId: string; }
    } | null>(null)
    
    const [text, setText] = useState<string>('')
    const [value] = useDebounce(text, 1000)
    const browserRef = useRef<HTMLDivElement>(null)
    const [focusedFormElement, setFocusedFormElement] = useState<FormElement | null>(null)

    // State variables to handle auto-refresh of site screenshots
    const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
    const [refreshInterval, setRefreshInterval] = useState<number>(2000); // 2 seconds
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);


    // Initialize session and connect to SSE
    useEffect(() => {
        // Prevent any browser updates until sessionId is defined
        if (!sessionId) {
            return;
        }

        const initBrowser = async () => {
            try {
                // Wait a short delay for the session to be properly initialized
                await new Promise(resolve => setTimeout(resolve, 100))
                
                // First try to navigate to the URL if it's provided
                if (url) {
                    await handleNavigation(url);
                } else {
                    // If no URL is provided, refresh the screenshot
                    await refreshScreenshot();
                }
                
                // Log success
                addLog('Browser initialized successfully');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                addLog(`Error initializing browser: ${errorMessage}`);
            }
        }

        initBrowser();

        return () => {
            if (refreshTimerRef.current) {
                clearInterval(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
        };
    }, [sessionId, url]);


    // Add this function to start/stop the auto-refresh
    const toggleAutoRefresh = (enabled: boolean) => {
        setAutoRefresh(enabled);

        // Clear existing timer
        if (refreshTimerRef.current) {
            clearInterval(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }

        // Start new timer if enabled
        if (enabled && browserRef.current) {
            refreshTimerRef.current = setInterval(async () => {
                // Only refresh if not already loading
                if (!isLoading && browserRef.current) {
                    await refreshScreenshot();
                }
            }, refreshInterval);
        }
    };


    // Add this function to manually refresh the screenshot
    const refreshScreenshot = async () => {
        if (!browserRef.current || isLoading) return;

        setIsLoading(true);
        try {
            // Create a simple action that doesn't change the page but returns a fresh screenshot
            const result = await performAction('refresh', '', undefined, sessionId);
            if (result.success) {
                updateBrowserState(result);
            }
        } catch (error) {
            console.error('Error refreshing screenshot:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Modify 
    const addLog = (message: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
    };

    const handleNavigation = async (targetUrl: string) => {
        setIsLoading(true);
        try {
            console.log("Navigating to ", targetUrl)
            const result = await navigateTo(targetUrl, sessionId);
            if (result.success) {
                updateBrowserState(result);
                addLog(`Loaded: ${result.url}`);

                // Restart auto-refresh after navigation
                if (autoRefresh) {
                    toggleAutoRefresh(false); // Stop current timer
                    toggleAutoRefresh(true);  // Start new timer
                }
            } else {
                addLog(`Navigation failed`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            addLog(`Error: ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    }

    const handleAction = useCallback(async (action: string, selector: string, value?: string) => {
        try {
            const result = await performAction(action, selector, value, sessionId);
            console.log("Result", result)
            if (result.success) {
                updateBrowserState(result);
                if (action === BrowserActions.EXTRACT) {
                    addLog(`Extracted content from ${selector}`);
                } else if (action === BrowserActions.MOUSE_CLICK) {
                    addLog(`Performed ${action} on x-y coordinates ${value}`)
                } else {
                    addLog(`Performed ${action} ${selector ? 'on ' + selector : ''}`);
                }
            } else {
                addLog(`Action failed`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            addLog(`Error: ${errorMessage}`);
        }
    }, [sessionId, updateBrowserState, addLog])

    const handleScreenshotClick = async (e: React.MouseEvent<HTMLImageElement>) => {
        if (!browserRef.current) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top

        const imageElement = e.currentTarget as HTMLImageElement;
        const scaleX = imageElement.naturalWidth / imageElement.offsetWidth;
        const scaleY = imageElement.naturalHeight / imageElement.offsetHeight;

        // Convert to actual coordinates on the screenshot
        const actualX = x * scaleX;
        const actualY = y * scaleY;

        console.log(`Click at position: (${actualX}, ${actualY})`);

        const clickedFormElement = formElements.find(el => {
            const isMatch = (
                (actualX >= el.x && actualX <= el.x + el.width) &&
                (actualY >= el.y && actualY <= el.y + el.height)
            )
            if (isMatch) {
                console.log(`Match found: ${el.tagName} "${el.value}" at (${el.x}, ${el.y})`);
            }
            return isMatch;
        }) || null;

        console.log(clickedFormElement)

        await handleAction('mouseClick', '', `${Math.round(actualX)},${Math.round(actualY)}`);


        setFocusedFormElement(clickedFormElement)

        // if (clickedElement) {
        //     addLog(`Clicked: ${clickedElement.text} (${clickedElement.href})`);

        //     if (clickedElement.href) {
        //         handleNavigation(clickedElement.href);
        //     } else {
        //         setIsLoading(true);
        //         await handleAction('mouseClick', '', `${clickedElement.x},${clickedElement.y}`);
        //         setIsLoading(false);
        //     }
        // } else {

        //     // If no element was found, use raw coordinates
        //     console.log(`No element found at position, using raw coordinates`);
        //     setIsLoading(true);
        //     await handleAction('mouseClick', '', `${Math.round(actualX)},${Math.round(actualY)}`);
        //     setIsLoading(false);
        // }
    }

    // Handle messages from iframe
    useEffect(() => {
        const handleIframeMessage = (event: MessageEvent) => {
            if (event.data.type === 'browserEvent') {
                const { event: eventType, text, href } = event.data;

                if (eventType === 'click') {
                    addLog(`Clicked: ${text || ''}${href ? ` (${href})` : ''}`);

                    if (href) {
                        handleNavigation(href);
                    }
                }
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, [sessionId]);


    const handleSubmitUrl = (e: React.FormEvent) => {
        e.preventDefault();

        // Trim the URL and validate
        const trimmedUrl = url.trim();
        if (!trimmedUrl) {
            addLog('Please enter a URL');
            return;
        }

        // Navigate to the URL
        handleNavigation(trimmedUrl);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
        
    }

    /**
     * Attenots to fill user's input into the currently focused form element
     */
    useEffect(() => {
        if (value && focusedFormElement) {
            console.log(`Filling ${focusedFormElement.id} with value ${value}`)
            handleAction('fill', `#${focusedFormElement.id}`, value)
        }
    }, [value, focusedFormElement, handleAction])

    
    const handleSubmitTextInput = (e: React.FormEvent) => {
        e.preventDefault();
        console.log("Focused form element", focusedFormElement)
        handleAction('press', focusedFormElement ? `#${focusedFormElement.id}` : '', 'Enter')
    }

    // Add login detection function
    const detectLoginForm = useCallback(() => {
        console.log('Checking form elements for login fields:', formElements);
        
        // Check for username/email field with expanded criteria
        const usernameField = formElements.find(el => {
            const fieldType = el.inputType?.toLowerCase() || '';
            const fieldName = el.name?.toLowerCase() || '';
            const fieldId = el.id?.toLowerCase() || '';
            const ariaLabel = el.ariaLabel?.toLowerCase() || '';
            const placeholder = el.placeholder?.toLowerCase() || '';
            const value = el.value?.toLowerCase() || '';
            const testId = el.dataTestId?.toLowerCase() || '';
            const role = el.role?.toLowerCase() || '';
            
            console.log('Checking field for username:', {
                fieldType,
                fieldName,
                fieldId,
                ariaLabel,
                placeholder,
                value,
                testId,
                role
            });
            
            const isTextInput = fieldType === 'text' || fieldType === 'email' || !fieldType;
            const hasLoginIdentifier = 
                fieldName.includes('user') || 
                fieldName.includes('email') || 
                fieldName.includes('username') ||
                fieldId.includes('user') || 
                fieldId.includes('email') ||
                fieldId.includes('username') ||
                ariaLabel?.includes('username') ||
                ariaLabel?.includes('email') ||
                placeholder?.includes('username') ||
                placeholder?.includes('email') ||
                placeholder?.includes('phone') || // Twitter allows phone login
                value?.includes('username') ||
                value?.includes('email') ||
                testId?.includes('username') ||
                testId?.includes('email') ||
                testId?.includes('text-input') ||
                role === 'textbox';

            return isTextInput && hasLoginIdentifier;
        });

        // Check for password field with expanded criteria
        const passwordField = formElements.find(el => {
            const fieldType = el.inputType?.toLowerCase() || '';
            const fieldName = el.name?.toLowerCase() || '';
            const fieldId = el.id?.toLowerCase() || '';
            const ariaLabel = el.ariaLabel?.toLowerCase() || '';
            const placeholder = el.placeholder?.toLowerCase() || '';
            const testId = el.dataTestId?.toLowerCase() || '';
            const role = el.role?.toLowerCase() || '';
            
            console.log('Checking field for password:', {
                fieldType,
                fieldName,
                fieldId,
                ariaLabel,
                placeholder,
                testId,
                role
            });
            
            return fieldType === 'password' || 
                   fieldName.includes('pass') || 
                   fieldId.includes('pass') ||
                   ariaLabel?.includes('password') ||
                   placeholder?.includes('password') ||
                   testId?.includes('password') ||
                   (role === 'textbox' && (fieldName.includes('pass') || fieldId.includes('pass')));
        });

        console.log('Login detection results:', {
            usernameField,
            passwordField
        });

        if (usernameField && passwordField) {
            setLoginFields({
                username: { 
                    id: usernameField.id || '', 
                    name: usernameField.name || '',
                    testId: usernameField.dataTestId || ''
                },
                password: { 
                    id: passwordField.id || '', 
                    name: passwordField.name || '',
                    testId: passwordField.dataTestId || ''
                }
            });
            setIsLoginDialogOpen(true);
            addLog('Login form detected');
        }
    }, [formElements, addLog]);

    // Check for login form when formElements change
    useEffect(() => {
        detectLoginForm();
    }, [formElements, detectLoginForm]);

    // Handle login credentials submission
    const handleLoginSubmit = async (username: string, password: string) => {
        if (!loginFields) return;

        try {
            // Fill username field
            await handleAction(
                BrowserActions.FILL_INPUT,
                loginFields.username.id ? `#${loginFields.username.id}` : 
                loginFields.username.testId ? `[data-testid="${loginFields.username.testId}"]` :
                `[name="${loginFields.username.name}"]`,
                username
            );

            // Fill password field
            await handleAction(
                BrowserActions.FILL_INPUT,
                loginFields.password.id ? `#${loginFields.password.id}` : 
                loginFields.password.testId ? `[data-testid="${loginFields.password.testId}"]` :
                `[name="${loginFields.password.name}"]`,
                password
            );

            // Find and click the submit button with expanded criteria
            const submitButton = formElements.find(el => {
                const type = el.inputType?.toLowerCase() || '';
                const value = el.value?.toLowerCase() || '';
                const tagName = el.tagName?.toLowerCase() || '';
                const ariaLabel = el.ariaLabel?.toLowerCase() || '';
                const testId = el.dataTestId?.toLowerCase() || '';
                const role = el.role?.toLowerCase() || '';
                
                return type === 'submit' || 
                       value?.includes('login') || 
                       value?.includes('sign in') ||
                       testId?.includes('login') ||
                       testId?.includes('signin') ||
                       (tagName === 'button' && (
                           value?.includes('login') || 
                           value?.includes('sign in') ||
                           ariaLabel?.includes('login') ||
                           ariaLabel?.includes('sign in') ||
                           role === 'button'
                       ));
            });

            if (submitButton) {
                await handleAction(
                    BrowserActions.CLICK_ELEMENT,
                    submitButton.id ? `#${submitButton.id}` : 
                    submitButton.dataTestId ? `[data-testid="${submitButton.dataTestId}"]` :
                    submitButton.selector,
                );
            } else {
                // If no submit button found, try pressing Enter on the password field
                await handleAction(
                    BrowserActions.PRESS,
                    loginFields.password.id ? `#${loginFields.password.id}` : 
                    loginFields.password.testId ? `[data-testid="${loginFields.password.testId}"]` :
                    `[name="${loginFields.password.name}"]`,
                    'Enter'
                );
            }

            addLog('Login credentials submitted');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            addLog(`Login error: ${errorMessage}`);
        }
    };

    return (
        <div className="flex flex-col h-full border rounded-md overflow-hidden bg-white">
            {/* Browser Controls */}
            <div className="flex items-center gap-2 p-2 border-b bg-gray-100">
                <Button
                    onClick={() => handleAction('back', '')}
                    disabled={!sessionId || !historyState.canGoBack}
                    size="sm"
                    variant="outline"
                >
                    ←
                </Button>
                <Button
                    onClick={() => handleAction('forward', '')}
                    disabled={!sessionId || !historyState.canGoForward}
                    size="sm"
                    variant="outline"
                >
                    →
                </Button>
                <Button
                    onClick={() => handleAction('reload', '')}
                    disabled={!sessionId}
                    size="sm"
                    variant="outline"
                >
                    ↻
                </Button>

                <form onSubmit={handleSubmitUrl} className="flex-1 flex gap-2">
                    <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="flex-1"
                        placeholder="Enter URL..."
                    />
                    <Button type="submit" disabled={!sessionId || isLoading}>
                        Go
                    </Button>
                </form>
                <button
                    onClick={refreshScreenshot}
                    className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                    title="Refresh screenshot"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 2v6h-6"></path>
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                        <path d="M3 22v-6h6"></path>
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                    </svg>
                </button>

                <div className="flex items-center ml-2">
                    <input
                        type="checkbox"
                        id="auto-refresh"
                        checked={autoRefresh}
                        onChange={(e) => toggleAutoRefresh(e.target.checked)}
                        className="mr-1"
                    />
                    <label htmlFor="auto-refresh" className="text-sm">Auto</label>
                </div>

                <select
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    className="ml-2 text-sm bg-gray-200 rounded p-1"
                    disabled={!autoRefresh}
                >
                    <option value={1000}>1s</option>
                    <option value={2000}>2s</option>
                    <option value={5000}>5s</option>
                    <option value={10000}>10s</option>
                </select>
            </div>

            {/* Browser Content */}
            <div
                ref={browserRef}
                className="flex-1 relative bg-white overflow-auto"
            >
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70 z-10">
                        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent"></div>
                    </div>
                )}

                {screenshot ? (
                    <Image
                        src={screenshot}
                        alt="Browser content"
                        className="w-full"
                        onClick={handleScreenshotClick}
                        width={1000}
                        height={1000}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center p-6">
                            <h3 className="text-lg font-semibold mb-2">No browser content available</h3>
                            <p className="text-gray-600 mb-4">Either enter a URL above or refresh the browser.</p>
                            <button 
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={refreshScreenshot}
                            >
                                Refresh Browser
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Action Panel */}
            <div className="border-t p-2 bg-gray-50">
                <div className="flex gap-2 mb-2">
                    <form onSubmit={handleSubmitTextInput} className='flex flex-1 gap-2'>
                        <Input
                            placeholder="Value (for inputs)"
                            onChange={handleTextChange}
                            disabled={!focusedFormElement}
                            id="value"
                            className="flex-1"
                        />
                        <Button
                            type="submit"
                            className='cursor-pointer'
                            disabled={!sessionId || !focusedFormElement}
                        >
                            Enter
                        </Button>
                    </form>
                </div>
                <div className="flex gap-2">
                </div>
            </div>

            {/* Logs */}
            <div className="border-t p-2 bg-gray-100 h-32 overflow-y-auto">
                <h3 className="text-sm font-semibold mb-1">Logs</h3>
                <div className="text-xs space-y-1">
                    {logs.map((log, i) => (
                        <div key={i} className="text-gray-700">{log}</div>
                    ))}
                </div>
            </div>

            {/* Add LoginCredentialsDialog */}
            <LoginCredentialsDialog
                isOpen={isLoginDialogOpen}
                onClose={() => setIsLoginDialogOpen(false)}
                onSubmit={handleLoginSubmit}
            />
        </div>
    )
}