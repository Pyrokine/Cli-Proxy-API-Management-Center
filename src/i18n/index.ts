/**
 * i18next 国际化配置
 */

import {getInitialLanguage} from '@/utils/language'
import i18n from 'i18next'
import {initReactI18next} from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

void i18n.use(initReactI18next).init({
                                         resources: {
                                             'zh-CN': { translation: zhCN },
                                             'zh-TW': { translation: zhTW },
                                             en: { translation: en },
                                             ru: { translation: ru },
                                         },
                                         lng: getInitialLanguage(),
                                         fallbackLng: 'zh-CN',
                                         interpolation: {
                                             escapeValue: false, // React 已经转义
                                         },
                                         react: {
                                             useSuspense: false,
                                         },
                                     })

export default i18n
