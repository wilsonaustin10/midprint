export type FormElement = {
    type: string;
    inputType: string;
    tagName: string;
    selector: string;
    id: string | null;
    name: string | null;
    placeholder: string | null;
    value: string | null;
    isRequired: boolean;
    isDisabled: boolean;
    isReadOnly: boolean;
    isChecked: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    isVisible: boolean;
    ariaLabel: string | null;
    ariaDescription: string | null;
    dataTestId: string | null;
    role: string | null;
}

export type ClickableElement = {
    type: string;
    tagName: string;
    text: string;
    selector: string;
    id: string | null;
    classes: string[] | [];
    href: string | null;
    role: string | null;
    ariaLabel: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    isVisible: boolean;
}

export type BrowserHistoryState = {
    canGoBack: boolean;
    canGoForward: boolean;
    currentIndex: number;
    length: number;
}