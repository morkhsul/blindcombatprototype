// embossEffect.js
import { Effect, BlendFunction } from 'postprocessing';
import { Uniform, Vector2 } from 'three';

const fragmentShader = /* glsl */ `
uniform float strength;
uniform vec2 lightDirection;
uniform float detailScale;

float rgb2luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 texelSize = 1.0 / vec2(textureSize(inputBuffer, 0)) * detailScale;

  // Sample 8 neighbours for Sobel
  float tl = rgb2luminance(texture(inputBuffer, uv + vec2(-texelSize.x,  texelSize.y)).rgb);
  float t  = rgb2luminance(texture(inputBuffer, uv + vec2( 0.0,          texelSize.y)).rgb);
  float tr = rgb2luminance(texture(inputBuffer, uv + vec2( texelSize.x,  texelSize.y)).rgb);
  float l  = rgb2luminance(texture(inputBuffer, uv + vec2(-texelSize.x,  0.0)).rgb);
  float r  = rgb2luminance(texture(inputBuffer, uv + vec2( texelSize.x,  0.0)).rgb);
  float bl = rgb2luminance(texture(inputBuffer, uv + vec2(-texelSize.x, -texelSize.y)).rgb);
  float b  = rgb2luminance(texture(inputBuffer, uv + vec2( 0.0,         -texelSize.y)).rgb);
  float br = rgb2luminance(texture(inputBuffer, uv + vec2( texelSize.x, -texelSize.y)).rgb);

  // Sobel gradients
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy =  tl + 2.0 * t + tr - bl - 2.0 * b - br;

  vec2 gradient = vec2(gx, gy);
  float mag = length(gradient);
  vec2 gradDir = normalize(gradient + 0.0001); // avoid zero vector

  // Bump intensity: how much the gradient aligns with light direction
  float bump = dot(gradDir, lightDirection) * mag * strength;

  // Centre around 0.5 (pure overlay‑ready grayscale)
  float bumpVal = 0.5 + bump * 0.5;
  bumpVal = clamp(bumpVal, 0.0, 1.0);

  outputColor = vec4(vec3(bumpVal), 1.0);
}
`;

export function createEmbossEffect() {
  return new Effect('Emboss', fragmentShader, {
    blendFunction: BlendFunction.OVERLAY,   // overlay blends with previous scene
    uniforms: new Map([
      ['strength', new Uniform(0.5)],
      ['lightDirection', new Uniform(new Vector2(1, 0))],
      ['detailScale', new Uniform(1.0)],
    ]),
  });
}