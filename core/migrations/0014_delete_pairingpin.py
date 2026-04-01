from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_remove_message_model_and_dead_settings"),
    ]

    operations = [
        migrations.DeleteModel(
            name="PairingPin",
        ),
    ]
