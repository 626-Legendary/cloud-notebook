import localFont from "next/font/local";
import { Noto_Sans_SC, Noto_Serif_SC, ZCOOL_XiaoWei, ZCOOL_QingKe_HuangYou, Ma_Shan_Zheng, Inter, Roboto, Open_Sans, Merriweather, IBM_Plex_Mono, Zhi_Mang_Xing, Long_Cang, Montserrat, Poppins, Plus_Jakarta_Sans, Lora, Cinzel, Caveat } from "next/font/google";

// No font preloads: the browser fetches self-hosted faces only when used.
const font0 = Noto_Sans_SC({ variable: "--font-noto-sans-sc", display: "swap", preload: false });
const font1 = Noto_Serif_SC({ variable: "--font-noto-serif-sc", display: "swap", preload: false });
const font2 = ZCOOL_XiaoWei({ variable: "--font-zcool-xiaowei", display: "swap", preload: false, weight: "400" });
const font3 = ZCOOL_QingKe_HuangYou({ variable: "--font-zcool-qingke-huangyou", display: "swap", preload: false, weight: "400" });
const font4 = Ma_Shan_Zheng({ variable: "--font-ma-shan-zheng", display: "swap", preload: false, weight: "400" });
const font5 = Inter({ variable: "--font-inter", display: "swap", preload: false });
const font6 = Roboto({ variable: "--font-roboto", display: "swap", preload: false });
const font7 = Open_Sans({ variable: "--font-open-sans", display: "swap", preload: false });
const font8 = Merriweather({ variable: "--font-merriweather", display: "swap", preload: false });
const font9 = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", display: "swap", preload: false, weight: ["400", "600", "700"] });

const huninn = localFont({ src: "../assets/fonts/jf-openhuninn-2.1.woff2", variable: "--font-jf-open-huninn", display: "swap", preload: false, weight: "400" });
const zhiMangXing = Zhi_Mang_Xing({ variable: "--font-zhi-mang-xing", display: "swap", preload: false, weight: "400" });
const longCang = Long_Cang({ variable: "--font-long-cang", display: "swap", preload: false, weight: "400" });
const montserrat = Montserrat({ variable: "--font-montserrat", display: "swap", preload: false });
const poppins = Poppins({ variable: "--font-poppins", display: "swap", preload: false, weight: ["400", "600", "700"] });
const plusJakartaSans = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta-sans", display: "swap", preload: false });
const lora = Lora({ variable: "--font-lora", display: "swap", preload: false });
const cinzel = Cinzel({ variable: "--font-cinzel", display: "swap", preload: false });
const caveat = Caveat({ variable: "--font-caveat", display: "swap", preload: false });

export const editorFontVariables = [font0.variable, font1.variable, font2.variable, font3.variable, font4.variable, font5.variable, font6.variable, font7.variable, font8.variable, font9.variable, huninn.variable, zhiMangXing.variable, longCang.variable, montserrat.variable, poppins.variable, plusJakartaSans.variable, lora.variable, cinzel.variable, caveat.variable].join(" ");
