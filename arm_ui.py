"""RoboAttis visual layer: reusable ttk styles, separate from serial control."""
import tkinter as tk
from tkinter import ttk
from arm_desktop import App

BG, CARD, PANEL = '#0b1220', '#18263b', '#121e30'
TEXT, MUTED, TEAL, BLUE = '#edf4ff', '#a0b3cb', '#50dbc0', '#82aaff'


def theme(root):
    root.configure(bg=BG)
    root.option_add('*Font', ('Segoe UI', 10))
    root.option_add('*TCombobox*Listbox.background', CARD)
    root.option_add('*TCombobox*Listbox.foreground', TEXT)
    s = ttk.Style(root)
    s.theme_use('clam')
    s.configure('.', background=BG, foreground=TEXT, font=('Segoe UI', 10), bordercolor='#30445f', lightcolor='#30445f', darkcolor='#30445f')
    s.configure('TFrame', background=BG)
    s.configure('TLabel', background=BG, foreground=MUTED)
    s.configure('Title.TLabel', foreground=TEXT, font=('Segoe UI', 24, 'bold'))
    s.configure('TButton', background='#22344e', foreground=TEXT, padding=(11, 6), borderwidth=1, focuscolor=BLUE)
    s.map('TButton', background=[('disabled', '#19273a'), ('active', '#304760')], foreground=[('disabled', '#7488a2')])
    for name, color, fill in [('Teal', TEAL, '#164f49'), ('Blue', BLUE, '#253f69'), ('Violet', '#c3aaff', '#423363'), ('Red', '#ff99ac', '#633044'), ('Amber', '#ffd08a', '#58442d')]:
        s.configure(name+'.TButton', background=fill, foreground=color, font=('Segoe UI', 10, 'bold'))
        s.map(name+'.TButton', background=[('disabled', '#19273a'), ('active', '#354760')], foreground=[('disabled', '#7488a2'), ('!disabled', color)])
        s.configure(name+'.TLabel', background=PANEL, foreground=color, font=('Segoe UI', 16, 'bold'))
    s.configure('TNotebook', background=BG, borderwidth=0)
    s.configure('TNotebook.Tab', background=CARD, foreground=MUTED, padding=(22, 9), font=('Segoe UI', 11, 'bold'))
    s.map('TNotebook.Tab', background=[('selected', '#264265')], foreground=[('selected', TEXT)])
    s.configure('TLabelframe', background=CARD, bordercolor='#30445f', borderwidth=1, relief='solid')
    s.configure('TLabelframe.Label', background=CARD, foreground=TEAL, font=('Segoe UI', 12, 'bold'))
    s.configure('Right.TLabelframe', background=CARD, bordercolor='#30445f', borderwidth=1, relief='solid')
    s.configure('Right.TLabelframe.Label', background=CARD, foreground=BLUE, font=('Segoe UI', 12, 'bold'))
    s.configure('Card.TFrame', background=CARD)
    s.configure('Card.TLabel', background=CARD, foreground=MUTED)
    s.configure('Readout.TLabel', background=CARD, foreground=TEXT, font=('Segoe UI', 18, 'bold'))
    s.configure('Panel.TFrame', background=PANEL)
    s.configure('Panel.TLabel', background=PANEL, foreground=MUTED, font=('Segoe UI', 9))
    s.configure('Horizontal.TScale', background=TEAL, troughcolor='#0e192a', sliderlength=22)
    s.configure('Right.Horizontal.TScale', background=BLUE, troughcolor='#0e192a', sliderlength=22)
    s.map('Horizontal.TScale', background=[('disabled', '#526681'), ('active', '#8feedd')])
    s.configure('TCombobox', fieldbackground=CARD, background=PANEL, foreground=TEXT, arrowcolor=TEAL, padding=6)
    s.map('TCombobox', fieldbackground=[('readonly', CARD), ('disabled', PANEL)], foreground=[('readonly', TEXT), ('disabled', MUTED)])
    s.configure('TEntry', fieldbackground=CARD, foreground=TEXT, insertcolor=TEXT, padding=7)
    s.configure('TCheckbutton', background=BG, foreground=TEXT, indicatorbackground=CARD)
    s.map('TCheckbutton', background=[('active', BG)], foreground=[('disabled', '#7488a2')], indicatorbackground=[('selected', TEAL)])


class StyledApp(App):
    def __init__(self, root):
        super().__init__(root)
        theme(root)
        root.title('RoboAttis Studio · Arm Control')
        root.geometry(f'{min(1220, root.winfo_screenwidth()-60)}x{min(900, root.winfo_screenheight()-80)}')
        root.minsize(1000, 650)
        for button, name in [(self.connect_button, 'Teal'), (self.record_button, 'Red'), (self.play_button, 'Teal'), (self.home_button, 'Blue'), (self.hold_button, 'Amber'), (self.file_buttons[0], 'Violet')]:
            button.configure(style=name+'.TButton')
        self.record_button.configure(text='● Record motion')
        self.stop_button.configure(bg='#a32d4c', activebackground='#ca4264', activeforeground='white', disabledforeground='#d7a0ad', relief='flat', borderwidth=0, padx=18, pady=8)
        for i, card in enumerate(self.cards):
            box = card['label'].master
            if i >= 4: box.configure(style='Right.TLabelframe')
            for child in box.winfo_children():
                if isinstance(child, ttk.Frame): child.configure(style='Card.TFrame')
            card['label'].configure(style='Readout.TLabel')
            card['info'].configure(style='Card.TLabel')
            if i >= 4: card['scale'].configure(style='Right.Horizontal.TScale')
            for key, name in [('enable', 'Teal'), ('off', 'Red'), ('home', 'Blue'), ('sethome', 'Violet')]:
                card['buttons'][key].configure(style=name+'.TButton')
        outer = self.connect_button.master.master
        notebook = next(w for w in outer.winfo_children() if isinstance(w, ttk.Notebook))
        # Scroll each arm independently so calibration controls fit laptop screens.
        self.arm_canvases = {}
        for tab in notebook.tabs():
            page = root.nametowidget(tab)
            boxes = list(page.winfo_children())
            for box in boxes: box.grid_forget()
            for n in range(2):
                page.rowconfigure(n, weight=0)
                page.columnconfigure(n, weight=0)
            canvas = tk.Canvas(page, bg=BG, highlightthickness=0, height=270)
            scrollbar = ttk.Scrollbar(page, orient='vertical', command=canvas.yview)
            scrollbar.pack(side='right', fill='y')
            canvas.pack(side='left', fill='both', expand=True)
            canvas.configure(yscrollcommand=scrollbar.set)
            body = ttk.Frame(canvas)
            item = canvas.create_window((0, 0), window=body, anchor='nw')
            for j, box in enumerate(boxes):
                box.grid(in_=body, row=j//2, column=j%2, sticky='nsew', padx=6, pady=6)
            body.columnconfigure(0, weight=1)
            body.columnconfigure(1, weight=1)
            body.bind('<Configure>', lambda e, cv=canvas: cv.configure(scrollregion=cv.bbox('all')))
            canvas.bind('<Configure>', lambda e, cv=canvas, key=item: cv.itemconfigure(key, width=e.width))
            self.arm_canvases[tab] = canvas
        root.bind('<MouseWheel>', lambda e: self.arm_canvases[notebook.select()].yview_scroll(int(-e.delta/120), 'units'))
        metrics = ttk.Frame(outer, style='Panel.TFrame', padding=(14, 8))
        metrics.pack(fill='x', before=notebook, pady=(0, 5))
        self.metric_values = []
        for index, (caption, name) in enumerate([('USB CONNECTION', 'Teal'), ('ENABLED JOINTS', 'Blue'), ('MOTION MODE', 'Violet')]):
            block = ttk.Frame(metrics, style='Panel.TFrame')
            block.grid(row=0, column=index, sticky='ew', padx=(0, 24))
            metrics.columnconfigure(index, weight=1)
            ttk.Label(block, text=caption, style='Panel.TLabel').pack(anchor='w')
            label = ttk.Label(block, style=name+'.TLabel')
            label.pack(anchor='w')
            self.metric_values.append(label)
        self.sequence_status.trace_add('write', lambda *_: self.update_metrics())
        self.update_metrics()

    def update_metrics(self):
        if not hasattr(self, 'metric_values'): return
        values = ['● Connected' if self.ready else '○ Offline', f'{sum(self.enabled):02d} / 08',
                  '● Recording' if self.recording else '▶ Playing' if self.playing else 'Manual control']
        for label, value in zip(self.metric_values, values): label.configure(text=value)

    def sync(self):
        super().sync()
        self.update_metrics()


if __name__ == '__main__':
    window = tk.Tk()
    StyledApp(window)
    window.mainloop()
