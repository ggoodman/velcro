import emotionStyled, { CreateStyled } from '@emotion/styled/macro';
import { ThemeProvider as EmotionThemeProvider, EmotionTheming } from 'emotion-theming';

export const theme = {};

export type Theme = typeof theme;

export default emotionStyled as CreateStyled<Theme>;
export const ThemeProvider = EmotionThemeProvider as EmotionTheming<Theme>['ThemeProvider'];
