import { NOISE_GLSL } from './noise-glsl'

export const WIREFRAME_VERT = /* glsl */ `#version 300 es
in vec3 a_pos;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform float u_time;
uniform float u_churn;
uniform float u_amp;
uniform float u_jagged;
out vec3 v_normal;
out vec3 v_worldPos;
${NOISE_GLSL}

void main() {
  vec3 p = a_pos;
  float slow = fbm3(p * 1.6 + vec3(u_time * u_churn * 0.16, u_time * u_churn * 0.11, 0.0));
  float fine = fbm3(p * 4.4 + vec3(-u_time * u_churn * 0.24, u_time * u_churn * 0.2, 3.0));
  float disp = mix(slow, fine, u_jagged) - 0.5;
  vec3 displaced = p * (1.0 + disp * u_amp * 0.2);
  vec4 world = u_model * vec4(displaced, 1.0);
  v_worldPos = world.xyz;
  v_normal = normalize((u_model * vec4(p, 0.0)).xyz);
  gl_Position = u_viewProj * world;
}
`

export const WIREFRAME_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_worldPos;
uniform vec3 u_cameraPos;
uniform vec3 u_accent;
uniform vec3 u_core;
uniform float u_brightness;
out vec4 fragColor;

void main() {
  vec3 viewDir = normalize(u_cameraPos - v_worldPos);
  float fres = pow(1.0 - clamp(dot(viewDir, v_normal), 0.0, 1.0), 2.15);
  vec3 col = mix(u_accent * 0.16, u_accent, fres);
  col += u_core * pow(fres, 3.2) * 0.7;
  col *= u_brightness;
  float alpha = clamp(0.2 + fres * 0.95, 0.0, 1.0) * u_brightness;
  fragColor = vec4(col * alpha, alpha);
}
`

export const BILLBOARD_VERT = /* glsl */ `#version 300 es
in vec2 a_quad;
uniform vec2 u_centerPx;
uniform vec2 u_sizePx;
uniform vec2 u_viewport;
uniform float u_rotation;
out vec2 v_uv;

void main() {
  float c = cos(u_rotation);
  float s = sin(u_rotation);
  vec2 rotated = vec2(a_quad.x * c - a_quad.y * s, a_quad.x * s + a_quad.y * c);
  vec2 px = u_centerPx + rotated * u_sizePx * 0.5;
  vec2 ndc = (px / u_viewport) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_uv = a_quad * 0.5 + 0.5;
}
`

export const BILLBOARD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 fragColor;

void main() {
  vec4 tex = texture(u_tex, v_uv);
  float a = tex.a * u_alpha;
  fragColor = vec4(tex.rgb * u_color * a, a);
}
`

export const RIBBON_VERT = /* glsl */ `#version 300 es
in vec3 a_pos;
in float a_side;
in float a_progress;
uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
uniform float u_width;
out float v_progress;
out float v_side;

void main() {
  vec3 toCam = normalize(u_cameraPos - a_pos);
  // Perpendicular offset direction approximated from the radial direction so the
  // ribbon reads as a ribbon from any reasonable camera angle without needing
  // per-segment tangent data.
  vec3 radial = length(a_pos) > 0.0001 ? normalize(a_pos) : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(toCam, radial));
  vec3 offset = side * a_side * u_width * 0.5;
  gl_Position = u_viewProj * vec4(a_pos + offset, 1.0);
  v_progress = a_progress;
  v_side = a_side;
}
`

export const RIBBON_FRAG = /* glsl */ `#version 300 es
precision highp float;
in float v_progress;
in float v_side;
uniform vec3 u_color;
uniform float u_head;
uniform float u_alpha;
out vec4 fragColor;

void main() {
  float edge = 1.0 - abs(v_side);
  float along = smoothstep(0.0, 0.08, u_head - v_progress) * smoothstep(-0.32, 0.0, u_head - v_progress);
  float intensity = edge * edge * along * u_alpha;
  fragColor = vec4(u_color * intensity, intensity);
}
`

export const RING_VERT = /* glsl */ `#version 300 es
in vec2 a_dir;
in float a_side;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform float u_pulsePhase;
uniform float u_width;
out float v_pulse;
out float v_side;

void main() {
  vec2 radial = a_dir * (1.0 + a_side * u_width);
  vec3 p = vec3(radial.x, 0.0, radial.y);
  gl_Position = u_viewProj * (u_model * vec4(p, 1.0));
  float angle = atan(a_dir.y, a_dir.x);
  v_pulse = 0.5 + 0.5 * cos(angle * 2.0 - u_pulsePhase);
  v_side = a_side;
}
`

export const RING_FRAG = /* glsl */ `#version 300 es
precision highp float;
in float v_pulse;
in float v_side;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 fragColor;

void main() {
  float edge = 1.0 - abs(v_side);
  float intensity = edge * (0.4 + 0.95 * pow(v_pulse, 3.0)) * u_alpha;
  fragColor = vec4(u_color * intensity, intensity);
}
`
