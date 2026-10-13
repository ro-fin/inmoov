"""Back up and migrate the local arm session to the current channel mapping."""
import json
import shutil
from datetime import datetime
from arm_desktop import SESSION, upgrade_session

if __name__ == '__main__':
    original = json.loads(SESSION.read_text(encoding='utf-8'))
    migrated = upgrade_session(original)
    if migrated != original:
        backup = SESSION.with_name('arm_desktop_session.before-v7-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
        shutil.copy2(SESSION, backup)
        temporary = SESSION.with_suffix('.tmp')
        temporary.write_text(json.dumps(migrated, indent=2), encoding='utf-8')
        temporary.replace(SESSION)
        print('Migrated session; backup: ' + backup.name)
    print('Joint pins:', [p['pin'] for p in migrated['servos']])
