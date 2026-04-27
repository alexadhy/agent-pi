// ABOUTME: Catppuccin Latte (light) and Mocha (dark) palette color definitions.
// ABOUTME: Each color includes hex, rgb, hsl, and oklch values for flexibility.

export interface CatppuccinColor {
	hex: string;
	rgb: [number, number, number];
	hsl: [number, number, number]; // [h, s%, l%]
}

export interface CatppuccinPalette {
	rosewater: CatppuccinColor;
	flamingo: CatppuccinColor;
	pink: CatppuccinColor;
	mauve: CatppuccinColor;
	red: CatppuccinColor;
	maroon: CatppuccinColor;
	peach: CatppuccinColor;
	yellow: CatppuccinColor;
	green: CatppuccinColor;
	teal: CatppuccinColor;
	sky: CatppuccinColor;
	sapphire: CatppuccinColor;
	blue: CatppuccinColor;
	lavender: CatppuccinColor;
	text: CatppuccinColor;
	subtext1: CatppuccinColor;
	subtext0: CatppuccinColor;
	overlay2: CatppuccinColor;
	overlay1: CatppuccinColor;
	overlay0: CatppuccinColor;
	surface2: CatppuccinColor;
	surface1: CatppuccinColor;
	surface0: CatppuccinColor;
	base: CatppuccinColor;
	mantle: CatppuccinColor;
	crust: CatppuccinColor;
}

export const LATTE: CatppuccinPalette = {
	rosewater: { hex: "#dc8a78", rgb: [220, 138, 120], hsl: [11, 59, 67] },
	flamingo:  { hex: "#dd7878", rgb: [221, 120, 120], hsl: [0, 60, 67] },
	pink:      { hex: "#ea76cb", rgb: [234, 118, 203], hsl: [316, 73, 69] },
	mauve:     { hex: "#8839ef", rgb: [136, 57, 239], hsl: [266, 85, 58] },
	red:       { hex: "#d20f39", rgb: [210, 15, 57], hsl: [347, 87, 44] },
	maroon:    { hex: "#e64553", rgb: [230, 69, 83], hsl: [355, 76, 59] },
	peach:     { hex: "#fe640b", rgb: [254, 100, 11], hsl: [22, 99, 52] },
	yellow:    { hex: "#df8e1d", rgb: [223, 142, 29], hsl: [35, 77, 49] },
	green:     { hex: "#40a02b", rgb: [64, 160, 43], hsl: [109, 58, 40] },
	teal:      { hex: "#179299", rgb: [23, 146, 153], hsl: [183, 74, 35] },
	sky:       { hex: "#04a5e5", rgb: [4, 165, 229], hsl: [197, 97, 46] },
	sapphire:  { hex: "#209fb5", rgb: [32, 159, 181], hsl: [189, 70, 42] },
	blue:      { hex: "#1e66f5", rgb: [30, 102, 245], hsl: [220, 91, 54] },
	lavender:  { hex: "#7287fd", rgb: [114, 135, 253], hsl: [231, 97, 72] },
	text:      { hex: "#4c4f69", rgb: [76, 79, 105], hsl: [234, 16, 35] },
	subtext1:  { hex: "#5c5f77", rgb: [92, 95, 119], hsl: [233, 13, 41] },
	subtext0:  { hex: "#6c6f85", rgb: [108, 111, 133], hsl: [233, 10, 47] },
	overlay2:  { hex: "#7c7f93", rgb: [124, 127, 147], hsl: [232, 10, 53] },
	overlay1:  { hex: "#8c8fa1", rgb: [140, 143, 161], hsl: [231, 10, 59] },
	overlay0:  { hex: "#9ca0b0", rgb: [156, 160, 176], hsl: [228, 11, 65] },
	surface2:  { hex: "#acb0be", rgb: [172, 176, 190], hsl: [227, 12, 71] },
	surface1:  { hex: "#bcc0cc", rgb: [188, 192, 204], hsl: [225, 14, 77] },
	surface0:  { hex: "#ccd0da", rgb: [204, 208, 218], hsl: [223, 16, 83] },
	base:      { hex: "#eff1f5", rgb: [239, 241, 245], hsl: [220, 23, 95] },
	mantle:    { hex: "#e6e9ef", rgb: [230, 233, 239], hsl: [220, 22, 92] },
	crust:     { hex: "#dce0e8", rgb: [220, 224, 232], hsl: [220, 21, 89] },
};

export const MOCHA: CatppuccinPalette = {
	rosewater: { hex: "#f5e0dc", rgb: [245, 224, 220], hsl: [10, 56, 91] },
	flamingo:  { hex: "#f2cdcd", rgb: [242, 205, 205], hsl: [0, 59, 88] },
	pink:      { hex: "#f5c2e7", rgb: [245, 194, 231], hsl: [316, 72, 86] },
	mauve:     { hex: "#cba6f7", rgb: [203, 166, 247], hsl: [267, 84, 81] },
	red:       { hex: "#f38ba8", rgb: [243, 139, 168], hsl: [343, 81, 75] },
	maroon:    { hex: "#eba0ac", rgb: [235, 160, 172], hsl: [350, 65, 77] },
	peach:     { hex: "#fab387", rgb: [250, 179, 135], hsl: [23, 92, 75] },
	yellow:    { hex: "#f9e2af", rgb: [249, 226, 175], hsl: [41, 86, 83] },
	green:     { hex: "#a6e3a1", rgb: [166, 227, 161], hsl: [115, 54, 76] },
	teal:      { hex: "#94e2d5", rgb: [148, 226, 213], hsl: [170, 57, 73] },
	sky:       { hex: "#89dceb", rgb: [137, 220, 235], hsl: [189, 71, 73] },
	sapphire:  { hex: "#74c7ec", rgb: [116, 199, 236], hsl: [199, 76, 69] },
	blue:      { hex: "#89b4fa", rgb: [137, 180, 250], hsl: [217, 92, 76] },
	lavender:  { hex: "#b4befe", rgb: [180, 190, 254], hsl: [232, 97, 85] },
	text:      { hex: "#cdd6f4", rgb: [205, 214, 244], hsl: [226, 64, 88] },
	subtext1:  { hex: "#bac2de", rgb: [186, 194, 222], hsl: [227, 35, 80] },
	subtext0:  { hex: "#a6adc8", rgb: [166, 173, 200], hsl: [228, 24, 72] },
	overlay2:  { hex: "#9399b2", rgb: [147, 153, 178], hsl: [228, 17, 64] },
	overlay1:  { hex: "#7f849c", rgb: [127, 132, 156], hsl: [230, 13, 55] },
	overlay0:  { hex: "#6c7086", rgb: [108, 112, 134], hsl: [231, 11, 47] },
	surface2:  { hex: "#585b70", rgb: [88, 91, 112], hsl: [233, 12, 39] },
	surface1:  { hex: "#45475a", rgb: [69, 71, 90], hsl: [234, 13, 31] },
	surface0:  { hex: "#313244", rgb: [49, 50, 68], hsl: [237, 16, 23] },
	base:      { hex: "#1e1e2e", rgb: [30, 30, 46], hsl: [240, 21, 15] },
	mantle:    { hex: "#181825", rgb: [24, 24, 37], hsl: [240, 21, 12] },
	crust:     { hex: "#11111b", rgb: [17, 17, 27], hsl: [240, 23, 9] },
};
