import { describe, it, expect } from 'vitest';
import { convertDanDanPlayComment } from '@/services/dandanplay/client';

describe('convertDanDanPlayComment', () => {
    it('parses DanDanPlay 4-field p as time,mode,color,user', () => {
        const raw = convertDanDanPlayComment({
            cid: 1,
            p: '12.5,1,16777215,[BiliBili]abc',
            m: 'hello',
        });
        expect(raw).toEqual({
            time: 12.5,
            modeId: 1,
            color: 16777215,
            text: 'hello',
            user: '[BiliBili]abc',
        });
    });

    it('does not wrap user with [DanDanPlay]', () => {
        const raw = convertDanDanPlayComment({
            cid: 2,
            p: '1,5,255,plain-user',
            m: 'top',
        });
        expect(raw.user).toBe('plain-user');
        expect(raw.color).toBe(255);
        expect(raw.modeId).toBe(5);
    });
});
