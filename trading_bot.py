# Çeşitlendirme: her kategoriden makul bir üst sınıra kadar izin ver
# (eskisi gibi "kategori başına sadece 1" değil — ALT kategorisi coinlerin
# büyük çoğunluğunu kapsadığı için bu, botu neredeyse tamamen durduruyordu).
# NOT: MAJOR (BTC, ETH, BNB vb.) coinlerin günlük volatilitesi genelde düşük;
# bu hızlı-momentum stratejisi için altcoinler daha uygun fırsat sunuyor.
# Bu yüzden MAJOR kapasitesi kasıtlı olarak düşük tutuluyor.
MAX_PER_CATEGORY = {"MAJOR": 3, "ALT": 10, "STABLE": 1}
