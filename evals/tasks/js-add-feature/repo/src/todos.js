export class TodoList {
  #items = [];
  #nextId = 1;

  add(title) {
    if (!title || !title.trim()) throw new Error('title is required');
    const todo = { id: this.#nextId++, title: title.trim(), done: false };
    this.#items.push(todo);
    return { ...todo };
  }

  complete(id) {
    const todo = this.#items.find((t) => t.id === id);
    if (!todo) throw new Error(`no todo with id ${id}`);
    todo.done = true;
    return { ...todo };
  }

  list() {
    return this.#items.map((t) => ({ ...t }));
  }
}
