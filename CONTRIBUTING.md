# Contributing to Real-Time Data Sync System

Спасибо за интерес к проекту! Мы рады любым contributions.

## 🚀 Как начать

1. **Fork** репозитория
2. **Clone** вашего fork
3. Создайте **feature branch**: `git checkout -b feature/amazing-feature`
4. **Commit** изменения: `git commit -m 'Add amazing feature'`
5. **Push** в branch: `git push origin feature/amazing-feature`
6. Откройте **Pull Request**

## 📋 Перед отправкой PR

Убедитесь что:

- [ ] `pnpm lint` проходит без ошибок
- [ ] `pnpm check` проходит без ошибок
- [ ] `pnpm test` (если есть тесты) проходит
- [ ] Код отформатирован (`pnpm format`)
- [ ] Добавлены комментарии для сложной логики
- [ ] README обновлён если добавлена новая функциональность

## 💻 Development процесс

### Запуск проекта

\`\`\`bash
pnpm install
pnpm db:start # Docker
pnpm db:setup # Миграции
pnpm dev # Dev server
\`\`\`

### Code Style

Мы используем:

- **ESLint** для статического анализа
- **Prettier** для форматирования
- **TypeScript** strict mode
- **Svelte 5** best practices

### Commit Messages

Используйте понятные commit messages:

- `feat: Add new feature`
- `fix: Fix bug in sync manager`
- `docs: Update README`
- `refactor: Refactor SQL builder`
- `test: Add tests for batch handler`
- `chore: Update dependencies`

## 🐛 Reporting Bugs

Создайте issue с:

1. Описанием проблемы
2. Шагами для воспроизведения
3. Ожидаемым и актуальным поведением
4. Environment info (OS, Node version, etc.)

## 💡 Feature Requests

Создайте issue с тегом `enhancement` и опишите:

1. Проблему которую решает фича
2. Предлагаемое решение
3. Альтернативные варианты

## 📞 Вопросы?

- 📧 Email: pryanishnikovartem@gmail.com
- 💬 Telegram: @FrankFMY
- 🐙 GitHub Issues

---

Спасибо за вклад в проект! 🎉
