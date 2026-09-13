import { mount, unmount, type Component } from 'svelte';
import InputDialog from './components/InputDialog.svelte';
import SelectDialog from './components/SelectDialog.svelte';

function mountDialog<T>(component: Component, props: Record<string, unknown>): Promise<T | null> {
    return new Promise((resolve) => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const app = mount(component, {
            target,
            props: {
                ...props,
                onConfirm: (value: T) => {
                    cleanup();
                    resolve(value);
                },
                onCancel: () => {
                    cleanup();
                    resolve(null);
                },
            },
        });
        function cleanup() {
            try {
                unmount(app);
            } catch {
                /* already gone */
            }
            target.remove();
        }
    });
}

export function showInputDialog(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
    return mountDialog<string>(InputDialog, { title, placeholder, defaultValue });
}

export function showSelectDialog(title: string, options: string[], defaultIndex = 0): Promise<number | null> {
    return mountDialog<number>(SelectDialog, { title, options, defaultIndex });
}
