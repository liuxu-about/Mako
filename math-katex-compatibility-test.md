# KaTeX Compatibility Test

这份文档用来快速验证 ColaMD 当前接入的 KaTeX 数学公式支持。

## 1. Inline Math

- Euler identity: $e^{i\pi} + 1 = 0$
- Gaussian density: $f(x) = \frac{1}{\sqrt{2\pi\sigma^2}} e^{- \frac{(x - \mu)^2}{2\sigma^2}}$
- Sum: $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$
- Integral: $\int_0^1 x^2 \, dx = \frac{1}{3}$

## 2. Display Math

$$
\hat{y} = \sigma(Wx + b)
$$

$$
\mathrm{softmax}(x_i) = \frac{e^{x_i}}{\sum_{j=1}^{n} e^{x_j}}
$$

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

## 3. Aligned

$$
\begin{aligned}
a^2 + b^2 &= c^2 \\
e^{i\pi} + 1 &= 0 \\
\nabla \cdot \vec{E} &= \frac{\rho}{\varepsilon_0}
\end{aligned}
$$

## 4. Matrices

$$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$$

$$
A =
\begin{pmatrix}
\alpha & \beta \\
\gamma & \delta
\end{pmatrix}
$$

## 5. Cases

$$
f(x) =
\begin{cases}
x^2, & x \ge 0 \\
-x, & x < 0
\end{cases}
$$

## 6. More Symbols

$$
\forall x \in \mathbb{R}, \exists y \in \mathbb{R} \text{ such that } y > x
$$

$$
\mathbf{F} = m\mathbf{a}, \quad
\partial_t u = \alpha \nabla^2 u
$$

## 7. Markdown Around Math

公式前后混排应该正常：

这是一个行内公式 $a_{ij}$，下面是一个块级公式：

$$
\det(A - \lambda I) = 0
$$

继续普通 Markdown：

- 列表 1
- 列表 2
- 列表中行内公式：$\sqrt{a^2 + b^2}$

## 8. Likely Unsupported Or Sensitive

下面这些更适合用来观察 KaTeX 的兼容边界，不一定都能完美通过：

$$
\begin{CD}
A @>>> B \\
@VVV @VVV \\
C @>>> D
\end{CD}
$$

$$
\require{physics}
\dv{y}{x}
$$

## 9. Raw Environment Without Math Fence

这一段按预期不应该渲染成公式，因为没有包在 `$...$` 或 `$$...$$` 里：

\begin{aligned}
a^2 + b^2 &= c^2 \\
e^{i\pi} + 1 &= 0
\end{aligned}
