package main

import (
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
)

type DiffResult struct {
	ChangedPixels     int64   `json:"changed_pixels"`
	TotalPixels       int64   `json:"total_pixels"`
	ChangedRatio      float64 `json:"changed_ratio"`
	DimensionMismatch bool    `json:"dimension_mismatch"`
}

func toNRGBA(img image.Image) *image.NRGBA {
	b := img.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

func diffPNG(baseline, current, diffPath string) (DiffResult, error) {
	bf, err := os.Open(baseline)
	if err != nil {
		return DiffResult{}, err
	}
	bi, err := png.Decode(bf)
	bf.Close()
	if err != nil {
		return DiffResult{}, err
	}
	cf, err := os.Open(current)
	if err != nil {
		return DiffResult{}, err
	}
	ci, err := png.Decode(cf)
	cf.Close()
	if err != nil {
		return DiffResult{}, err
	}
	b := toNRGBA(bi)
	c := toNRGBA(ci)
	w := b.Bounds().Dx()
	h := b.Bounds().Dy()
	res := DiffResult{}
	if c.Bounds().Dx() != w || c.Bounds().Dy() != h {
		res.DimensionMismatch = true
		w = max(w, c.Bounds().Dx())
		h = max(h, c.Bounds().Dy())
	}
	if w <= 0 || h <= 0 {
		return res, errors.New("empty image")
	}
	res.TotalPixels = int64(w * h)
	d := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var bp, cp color.NRGBA
			if x < b.Bounds().Dx() && y < b.Bounds().Dy() {
				bp = b.NRGBAAt(x, y)
			} else {
				bp = color.NRGBA{0, 0, 0, 0}
			}
			if x < c.Bounds().Dx() && y < c.Bounds().Dy() {
				cp = c.NRGBAAt(x, y)
			} else {
				cp = color.NRGBA{0, 0, 0, 0}
			}
			if bp != cp {
				res.ChangedPixels++
				d.SetNRGBA(x, y, color.NRGBA{255, 0, 255, 255})
			} else {
				g := uint8((uint16(cp.R) + uint16(cp.G) + uint16(cp.B)) / 3)
				d.SetNRGBA(x, y, color.NRGBA{g, g, g, 90})
			}
		}
	}
	res.ChangedRatio = float64(res.ChangedPixels) / float64(res.TotalPixels)
	out, err := os.Create(diffPath)
	if err != nil {
		return res, err
	}
	err = png.Encode(out, d)
	ce := out.Close()
	if err == nil {
		err = ce
	}
	return res, err
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
