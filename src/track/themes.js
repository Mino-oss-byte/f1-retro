// Look of each track: sky/fog colors, ground and road colors, lighting and scenery.
// `apron` is the width of the paved run-off strip on turns (0 on street circuits).
export const THEMES = {
  overcast: {
    sky: 0xaab4be, fog: [0xaab4be, 140, 620], ground: 0x3f7a3a, road: 0x3a3a3a,
    hemi: [0xdfe6ee, 0x4a5a44, 1.5], sun: [0xffffff, 0.7], apron: 6, scenery: 'stands', trees: 400,
  },
  sunny: {
    sky: 0x6ec6ff, fog: [0x9ad8ff, 180, 700], ground: 0x2f8a35, road: 0x3c3c40,
    hemi: [0xffffff, 0x446644, 1.6], sun: [0xfff4d6, 1.3], apron: 6, scenery: 'stands', trees: 500,
  },
  desert: {
    sky: 0x8fd0ff, fog: [0xc8dcc0, 180, 700], ground: 0x7d8a3c, road: 0x404044,
    hemi: [0xffffff, 0x665533, 1.6], sun: [0xfff0c8, 1.3], apron: 6, scenery: 'stands', trees: 150,
  },
  forest: {
    sky: 0x9db8c8, fog: [0x9db8c8, 100, 480], ground: 0x1f5a2a, road: 0x363638,
    hemi: [0xdfeede, 0x1f3a22, 1.4], sun: [0xfff8e0, 0.9], apron: 6, scenery: 'stands', trees: 3500,
  },
  night: {
    sky: 0x05060f, fog: [0x070814, 120, 650], ground: 0x14161c, road: 0x2e2e34,
    hemi: [0x6a7bd8, 0x1a1a30, 1.3], sun: [0x8899ff, 0.25], apron: 0, scenery: 'city', trees: 0,
  },
};
